import { isPunchTimelineValid } from "../punch-sequence";
import { computeAttendanceFromPunches } from "../recompute";
import { toPKTDate, toPKTTime } from "../time";
import type { DeviceImportRowStatus, DevicePunchReportRow } from "./contracts";

export type DeviceTimelinePunch = {
  id: string;
  timestamp: Date | string;
  attendanceDate: string;
  direction: "in" | "out";
};
export type DevicePlannedPunch = {
  timestamp: Date;
  attendanceDate: string;
  reportDate: string;
  direction: "in" | "out";
  existingPunchId: string | null;
  /** Set when an existing punch is reassigned to another attendance date. */
  movedFromDate?: string;
};
export type DevicePlannedRow = {
  row: DevicePunchReportRow;
  status: DeviceImportRowStatus;
  messages: string[];
  punches: DevicePlannedPunch[];
  dutyHours: string | null;
  attendanceDates: string[];
};
type Claim = Pick<
  DeviceTimelinePunch,
  "timestamp" | "attendanceDate" | "direction"
> & { punchId: string | null };
type DailyRow = { date: string; status: string; entrySource: string | null };
const millis = (value: string | Date) => new Date(value).getTime();

function mayCloseOvernight(
  previous: DeviceTimelinePunch,
  incoming: Date,
  shifts: { start: string; end: string }[],
) {
  const previousTime = toPKTTime(previous.timestamp).slice(0, 5);
  const nightSchedule = shifts.some((s) => s.end < s.start);
  const previousDate = new Date(`${previous.attendanceDate}T00:00:00+05:00`);
  const dayDifference =
    (new Date(`${toPKTDate(incoming)}T00:00:00+05:00`).getTime() -
      previousDate.getTime()) /
    86_400_000;
  return (
    previous.direction === "in" &&
    dayDifference === 1 &&
    incoming.getTime() - millis(previous.timestamp) <= 86_400_000 &&
    toPKTTime(incoming) < "12:00:00" &&
    (previousTime >= "20:00" || nightSchedule)
  );
}

function precedingPunch(
  punches: DeviceTimelinePunch[],
  timestamp: number,
): DeviceTimelinePunch | undefined {
  let low = 0,
    high = punches.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (millis(punches[middle].timestamp) < timestamp) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? punches[low - 1] : undefined;
}

export function planDeviceEmployeeRows(input: {
  rows: DevicePunchReportRow[];
  existingPunches: DeviceTimelinePunch[];
  claims: Claim[];
  attendanceRows: DailyRow[];
  lockedDates: Set<string>;
  shifts: { start: string; end: string }[];
  now: Date;
}): DevicePlannedRow[] {
  // Copies: overnight check-ins are reassigned in place while planning.
  const existing = input.existingPunches
    .map((p) => ({ ...p }))
    .sort((a, b) => millis(a.timestamp) - millis(b.timestamp));
  const byTimestamp = new Map<number, DeviceTimelinePunch[]>();
  const byDay = new Map<string, DeviceTimelinePunch[]>();
  for (const punch of existing) {
    const stamp = millis(punch.timestamp);
    byTimestamp.set(stamp, [...(byTimestamp.get(stamp) ?? []), punch]);
    byDay.set(punch.attendanceDate, [
      ...(byDay.get(punch.attendanceDate) ?? []),
      punch,
    ]);
  }
  const claims = new Map(input.claims.map((c) => [millis(c.timestamp), c]));
  const attendance = new Map(input.attendanceRows.map((r) => [r.date, r]));
  const today = toPKTDate(input.now);
  const results: DevicePlannedRow[] = [];
  let lastAdded: DeviceTimelinePunch | undefined;
  // Planned punch and its row for each punch added by this upload.
  const addedBy = new Map<
    DeviceTimelinePunch,
    { result: DevicePlannedRow; planned: DevicePlannedPunch }
  >();

  for (const row of [...input.rows].sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") || a.rowNumber - b.rowNumber,
  )) {
    const result: DevicePlannedRow = {
      row,
      status: "ready",
      messages: [...row.issues],
      punches: [],
      dutyHours: null,
      attendanceDates: [],
    };
    results.push(result);
    if (!row.date || row.issues.length) {
      result.status = "needs_review";
      continue;
    }
    if (row.punches.length === 0) {
      result.status = "needs_review";
      result.messages.push(
        "No punches recorded. HR must resolve this day's attendance status.",
      );
      continue;
    }
    if (
      row.date > today ||
      row.punches.some(
        (time) => millis(`${row.date}T${time}:00+05:00`) > input.now.getTime(),
      )
    ) {
      result.status = "needs_review";
      result.messages.push("Future punches require HR review.");
      continue;
    }
    const affected = new Set<string>();
    const additions = new Map<string, DeviceTimelinePunch[]>();
    let previousAdded = lastAdded;
    let conflict: string | null = null;
    // Overnight shifts count on the checkout date, so the open IN moves there.
    let overnightIn: DeviceTimelinePunch | null = null;
    for (const time of row.punches) {
      const timestamp: Date = new Date(`${row.date}T${time}:00+05:00`);
      const stamp = timestamp.getTime();
      const claimed = claims.get(stamp);
      if (claimed) {
        affected.add(claimed.attendanceDate);
        continue;
      }
      const matches = byTimestamp.get(stamp) ?? [];
      if (matches.length > 1) {
        conflict =
          "Multiple existing punches share this minute. HR must resolve the timeline.";
        break;
      }
      const match = matches[0];
      if (match) {
        affected.add(match.attendanceDate);
        result.punches.push({
          timestamp,
          direction: match.direction,
          attendanceDate: match.attendanceDate,
          reportDate: row.date,
          existingPunchId: match.id,
        });
        continue;
      }
      const oldPrevious = precedingPunch(existing, stamp);
      const previous: DeviceTimelinePunch | undefined =
        previousAdded &&
        (!oldPrevious ||
          millis(previousAdded.timestamp) > millis(oldPrevious.timestamp))
          ? previousAdded
          : oldPrevious;
      let attendanceDate = row.date;
      let direction: "in" | "out" = "in";
      if (previous?.direction === "in") {
        if (previous.attendanceDate === row.date) direction = "out";
        else if (mayCloseOvernight(previous, timestamp, input.shifts)) {
          direction = "out";
          overnightIn = previous;
          affected.add(previous.attendanceDate);
          if (input.lockedDates.has(previous.attendanceDate)) {
            conflict =
              "The overnight check-in belongs to approved or paid payroll.";
            result.status = "blocked";
            break;
          }
        }
      }
      const day = attendance.get(attendanceDate);
      affected.add(attendanceDate);
      if (input.lockedDates.has(attendanceDate)) {
        conflict = "This attendance date belongs to approved or paid payroll.";
        result.status = "blocked";
        break;
      }
      if (day && day.status !== "present") {
        conflict = `HR marked this date ${day.status}. Resolve it in the attendance editor first.`;
        result.status = "blocked";
        break;
      }
      if (
        day?.status === "present" &&
        day.entrySource === "manual" &&
        !byDay.get(attendanceDate)?.length
      ) {
        conflict =
          "This date has a manual HR attendance decision without punches. Review it before importing.";
        result.status = "blocked";
        break;
      }
      const planned: DevicePlannedPunch = {
        timestamp,
        direction,
        attendanceDate,
        reportDate: row.date,
        existingPunchId: null,
      };
      result.punches.push(planned);
      affected.add(attendanceDate);
      previousAdded = {
        id: `device:${row.rowNumber}:${time}`,
        timestamp,
        attendanceDate,
        direction,
      };
      addedBy.set(previousAdded, { result, planned });
      const list = additions.get(attendanceDate) ?? [];
      list.push(previousAdded);
      additions.set(attendanceDate, list);
    }
    const movedIn = overnightIn;
    const merged = new Map<string, DeviceTimelinePunch[]>();
    for (const date of affected) {
      const punches = [
        ...(byDay.get(date) ?? []).filter((p) => p !== movedIn),
        ...(additions.get(date) ?? []),
        ...(movedIn && date === row.date
          ? [{ ...movedIn, attendanceDate: row.date }]
          : []),
      ].sort((a, b) => millis(a.timestamp) - millis(b.timestamp));
      merged.set(date, punches);
      if (!isPunchTimelineValid(punches))
        conflict ??=
          "These times conflict with existing IN/OUT punches or HR corrections. Resolve the timeline manually.";
    }
    result.attendanceDates = [...affected].sort();
    if (conflict) {
      if (result.status !== "blocked") result.status = "needs_review";
      result.messages.push(conflict);
      result.punches = [];
      continue;
    }
    if (movedIn) {
      const fromDate = movedIn.attendanceDate;
      const source = addedBy.get(movedIn);
      if (source) {
        // IN came from an earlier row of this upload; it is not saved yet.
        source.planned.attendanceDate = row.date;
        if (!source.result.punches.some((p) => p.attendanceDate === fromDate))
          source.result.attendanceDates = source.result.attendanceDates.filter(
            (date) => date !== fromDate,
          );
        if (!source.result.attendanceDates.includes(row.date))
          source.result.attendanceDates = [
            ...source.result.attendanceDates,
            row.date,
          ].sort();
      } else {
        result.punches.unshift({
          timestamp: new Date(movedIn.timestamp),
          direction: "in",
          attendanceDate: row.date,
          reportDate: fromDate,
          existingPunchId: movedIn.id,
          movedFromDate: fromDate,
        });
      }
      // Keep the moved punch identity so later rows can find it by reference.
      movedIn.attendanceDate = row.date;
      const target = merged.get(row.date)!;
      merged.set(
        row.date,
        target.map((p) => (p.id === movedIn.id ? movedIn : p)),
      );
      if (!merged.get(fromDate)?.length)
        result.attendanceDates = result.attendanceDates.filter(
          (date) => date !== fromDate,
        );
    }
    for (const [date, punches] of merged) byDay.set(date, punches);
    lastAdded = previousAdded;
    if (!result.punches.some((p) => !p.existingPunchId || p.movedFromDate))
      result.status = "unchanged";
  }

  // Each day is summarized once after all report rows, including morning checkouts.
  const summaries = new Map<
    string,
    ReturnType<typeof computeAttendanceFromPunches>
  >();
  for (const result of results) {
    if (!result.attendanceDates.length || result.status === "blocked") continue;
    for (const date of result.attendanceDates) {
      if (!summaries.has(date))
        summaries.set(
          date,
          computeAttendanceFromPunches(byDay.get(date) ?? [], {
            shifts: input.shifts,
            graceMinutes: 15,
            nightShiftStartHour: 20,
          }),
        );
    }
    result.dutyHours = result.attendanceDates
      .reduce((sum, date) => sum + Number(summaries.get(date)!.dutyHours), 0)
      .toFixed(2);
    const unresolved = result.attendanceDates.filter((date) => {
      const decision = attendance.get(date);
      return (
        (!decision || decision.status === "present") &&
        (summaries.get(date)!.openInCount > 0 || !byDay.get(date)?.length)
      );
    });
    if (unresolved.some((date) => date < today || !byDay.get(date)?.length)) {
      result.status = "needs_review";
      result.messages.push(
        "Missing or incomplete punches. HR must correct this attendance day or resolve its status before payroll.",
      );
    } else if (unresolved.length)
      result.messages.push(
        "Today's attendance is still open; a later upload can add the checkout.",
      );
    if (result.attendanceDates.some((date) => date !== result.row.date)) {
      result.messages.push(
        `Attendance dates (overnight or HR correction): ${result.attendanceDates.join(", ")}.`,
      );
    }
  }
  return results;
}
