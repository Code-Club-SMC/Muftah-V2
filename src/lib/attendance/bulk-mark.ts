import { isFieldStaff } from "./device-import/field-staff";
import {
  DRIVER_TRIP_ENTRY_SOURCE,
  ORDER_BOOKER_TRIP_ENTRY_SOURCE,
  SALESMAN_ACTIVITY_ENTRY_SOURCE,
} from "./order-booker-day-state";
import { toPKTDate } from "./time";

export const MAX_BULK_DAYS = 92;
/** Saved on every punch Bulk Mark adds. Shown in the punch timeline. */
export const BULK_PUNCH_NOTE = "Bulk Mark";
const DAY_MS = 86_400_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const ACTIVITY_SOURCES: string[] = [
  ORDER_BOOKER_TRIP_ENTRY_SOURCE,
  SALESMAN_ACTIVITY_ENTRY_SOURCE,
  DRIVER_TRIP_ENTRY_SOURCE,
];

export type BulkStatus = "present" | "absent" | "leave" | "holiday";
type Shift = { start: string; end: string };

export type BulkEmployee = {
  id: string;
  joiningDate: string;
  restDays: number[] | null;
  shifts: Shift[] | null;
  standardDutyHours: number | null;
  isOrderBooker?: boolean | null;
  isSalesman?: boolean | null;
  isDriver?: boolean | null;
};

export type BulkRecord = {
  id: string;
  employeeId: string;
  date: string;
  status: string;
  entrySource: string | null;
  overtimeCompensationMethod: string | null;
};

export type BulkPunch = {
  employeeId: string;
  attendanceDate: string;
  timestamp: Date;
};

export type BulkPunchWrite = { direction: "in" | "out"; timestamp: Date };

export type BulkWrite<E, R> = {
  employee: E;
  date: string;
  existing: R | undefined;
  /** Shift punches for office staff marked present; null writes the day directly. */
  punches: BulkPunchWrite[] | null;
  dutyHours: string;
};

export function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Number of days from start to end, counting both. */
export function countDays(startDate: string, endDate: string) {
  return (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1;
}

export function datesBetween(startDate: string, endDate: string) {
  return Array.from(
    { length: Math.max(0, countDays(startDate, endDate)) },
    (_, index) => addDays(startDate, index),
  );
}

function seconds(value: string) {
  const match = TIME_RE.exec(value);
  if (!match) return null;
  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
  );
}

/**
 * One IN and one OUT per shift. Null when there is no shift, or the shifts are
 * incomplete, out of order or overlapping, so no guessed hours are saved.
 * Only the last shift may run past midnight.
 */
export function buildShiftPunches(
  date: string,
  shifts: Shift[] | null,
): BulkPunchWrite[] | null {
  const used = (shifts ?? []).filter((shift) => shift.start || shift.end);
  if (!used.length) return null;
  const midnight = new Date(`${date}T00:00:00+05:00`).getTime();
  const result: BulkPunchWrite[] = [];
  let firstStart: number | null = null;
  let previousEnd = 0;
  for (const shift of used) {
    const start = seconds(shift.start);
    const endOfDay = seconds(shift.end);
    if (start === null || endOfDay === null || start === endOfDay) return null;
    if (start < previousEnd) return null;
    const end = endOfDay < start ? endOfDay + 86_400 : endOfDay;
    firstStart ??= start;
    if (end > firstStart + 86_400) return null;
    previousEnd = end;
    result.push(
      { direction: "in", timestamp: new Date(midnight + start * 1000) },
      { direction: "out", timestamp: new Date(midnight + end * 1000) },
    );
  }
  return result;
}

type UndoPunch = {
  id: string;
  employeeId: string;
  attendanceDate: string;
  source: string;
  note: string | null;
  createdAt: Date;
};
type UndoRecord = {
  employeeId: string;
  date: string;
  status: string;
  updatedAt: Date;
};

/**
 * Picks the days that are still exactly as Bulk Mark Present left them. Bulk Mark saves the
 * day and its punches with one timestamp, so any later edit or added punch shows up here.
 */
export function planBulkUndo<P extends UndoPunch>(input: {
  punches: P[];
  records: UndoRecord[];
  /** "employeeId:date" for each day a device upload also covers. */
  claimedDays: Set<string>;
}) {
  const days = new Map<string, P[]>();
  for (const punch of input.punches) {
    const key = `${punch.employeeId}:${punch.attendanceDate}`;
    days.set(key, [...(days.get(key) ?? []), punch]);
  }
  const records = new Map(
    input.records.map((row) => [`${row.employeeId}:${row.date}`, row]),
  );
  const writes: { employeeId: string; date: string; punches: P[] }[] = [];
  let keptEdited = 0;
  for (const [key, punches] of days) {
    if (!punches.some((punch) => punch.note === BULK_PUNCH_NOTE)) continue;
    const record = records.get(key);
    const untouched =
      record?.status === "present" &&
      !input.claimedDays.has(key) &&
      punches.every(
        (punch) =>
          punch.source === "manual" &&
          punch.note === BULK_PUNCH_NOTE &&
          punch.createdAt.getTime() === record.updatedAt.getTime(),
      );
    if (!untouched) {
      keptEdited++;
      continue;
    }
    const { employeeId, attendanceDate: date } = punches[0];
    writes.push({ employeeId, date, punches });
  }
  return { writes, keptEdited };
}

export type BulkSummary = ReturnType<typeof emptySummary>;

const emptySummary = () => ({
  created: 0,
  updated: 0,
  skippedRestDays: 0,
  skippedExisting: 0,
  /** Days with punches or recorded field work. These are never replaced in bulk. */
  skippedPunchDays: 0,
  skippedMissingShift: 0,
  skippedFuture: 0,
  skippedNotJoined: 0,
  skippedHolidays: 0,
});

/** The only place that decides what a bulk mark does, for the preview and the save. */
export function planBulkAttendance<
  E extends BulkEmployee,
  R extends BulkRecord,
>(input: {
  status: BulkStatus;
  conflictStrategy: "skip" | "overwrite";
  dates: string[];
  employees: E[];
  records: R[];
  punches: BulkPunch[];
  /** "employeeId:date" for each day an order booker has a saved trip. */
  tripDays: Set<string>;
  now: Date;
}) {
  const { status, conflictStrategy } = input;
  const today = toPKTDate(input.now);
  const key = (employeeId: string, date: string) => `${employeeId}:${date}`;
  const records = new Map(
    input.records.map((row) => [key(row.employeeId, row.date), row]),
  );
  const punchDays = new Set(
    input.punches.map((punch) => key(punch.employeeId, punch.attendanceDate)),
  );
  const punchTimes = new Map<string, number[]>();
  for (const punch of input.punches) {
    const times = punchTimes.get(punch.employeeId) ?? [];
    times.push(punch.timestamp.getTime());
    punchTimes.set(punch.employeeId, times);
  }

  const summary = emptySummary();
  const writes: BulkWrite<E, R>[] = [];

  for (const employee of input.employees) {
    const restDays = employee.restDays ?? [0];
    const field = isFieldStaff(employee);
    for (const date of input.dates) {
      const existing = records.get(key(employee.id, date));
      if (date < employee.joiningDate) {
        summary.skippedNotJoined++;
        continue;
      }
      if (restDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
        summary.skippedRestDays++;
        continue;
      }
      if ((status === "present" || status === "absent") && date > today) {
        summary.skippedFuture++;
        continue;
      }
      const worked =
        punchDays.has(key(employee.id, date)) ||
        input.tripDays.has(key(employee.id, date)) ||
        ACTIVITY_SOURCES.includes(existing?.entrySource ?? "") ||
        // A device upload marks field staff present without saving punches.
        (field &&
          existing?.status === "present" &&
          existing.entrySource === "biometric") ||
        // These hours are already in the comp-off bank.
        existing?.overtimeCompensationMethod === "comp_off";
      if (worked) {
        summary.skippedPunchDays++;
        continue;
      }
      if (existing && conflictStrategy === "skip") {
        summary.skippedExisting++;
        continue;
      }
      if (status === "leave" && existing?.status === "holiday") {
        summary.skippedHolidays++;
        continue;
      }

      let punches: BulkPunchWrite[] | null = null;
      if (status === "present" && !field) {
        punches = buildShiftPunches(date, employee.shifts);
        if (!punches) {
          summary.skippedMissingShift++;
          continue;
        }
        const first = punches[0].timestamp.getTime();
        const last = punches[punches.length - 1].timestamp.getTime();
        if (last > input.now.getTime()) {
          summary.skippedFuture++;
          continue;
        }
        // Punches saved under a neighbouring day can fall inside this shift.
        if (
          punchTimes
            .get(employee.id)
            ?.some((time) => time > first && time < last)
        ) {
          summary.skippedPunchDays++;
          continue;
        }
      }

      if (existing) summary.updated++;
      else summary.created++;
      writes.push({
        employee,
        date,
        existing,
        punches,
        dutyHours:
          status === "present" && field
            ? (employee.standardDutyHours || 8).toFixed(2)
            : "0.00",
      });
    }
  }

  return {
    writes,
    summary,
    noteNeeded: writes.some((write) => isFieldStaff(write.employee)),
  };
}

export function bulkResultMessage(summary: BulkSummary) {
  const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
  const skipped = [
    [summary.skippedPunchDays, "already worked"],
    [summary.skippedExisting, "already marked"],
    [summary.skippedRestDays, "rest days"],
    [summary.skippedHolidays, "holidays"],
    [summary.skippedMissingShift, "without a usable shift"],
    [summary.skippedFuture, "not finished yet"],
    [summary.skippedNotJoined, "before joining"],
  ].flatMap(([count, label]) => (count ? [`${count} ${label}`] : []));
  return [
    `${days(summary.created)} added, ${days(summary.updated)} replaced.`,
    skipped.length ? `Skipped: ${skipped.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
