import { toPKTTime } from "./time";

export type Punch = {
  direction: "in" | "out";
  timestamp: string | Date;
};

export type Shift = { start: string; end: string };

export type RecomputeOptions = {
  shifts: Shift[];
  graceMinutes: number;
  nightShiftStartHour: number;
  forceNightShift?: boolean;
};

export type ShiftViolation = {
  shiftIndex: number;
  late: boolean;
  earlyDeparture: boolean;
  expectedIn?: string;
  actualIn?: string;
  expectedOut?: string;
  actualOut?: string;
};

export type RecomputeResult = {
  checkIn: string | null;
  checkOut: string | null;
  dutyHours: string;
  isLate: boolean | null;
  isNightShift: boolean;
  earlyDepartureStatus: "none" | "pending";
  openInCount: number;
  shiftViolations: ShiftViolation[];
};

type NormalizedPunch = {
  direction: "in" | "out";
  time: string;
  secondsOfDay: number;
  sortValue: number;
  hasAbsoluteTime: boolean;
};

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function parseTimeToSeconds(value: string): number | null {
  const match = TIME_RE.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function formatSeconds(secondsOfDay: number): string {
  const hours = Math.floor(secondsOfDay / 3600);
  const minutes = Math.floor((secondsOfDay % 3600) / 60);
  const seconds = secondsOfDay % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function normalizePunch(punch: Punch, index: number): NormalizedPunch {
  if (punch.timestamp instanceof Date) {
    const time = toPKTTime(punch.timestamp);
    return {
      direction: punch.direction,
      time,
      secondsOfDay: parseTimeToSeconds(time) ?? 0,
      sortValue: punch.timestamp.getTime(),
      hasAbsoluteTime: true,
    };
  }

  const timeOnlySeconds = parseTimeToSeconds(punch.timestamp);
  if (timeOnlySeconds !== null) {
    return {
      direction: punch.direction,
      time: formatSeconds(timeOnlySeconds),
      secondsOfDay: timeOnlySeconds,
      sortValue: timeOnlySeconds * 1000 + index,
      hasAbsoluteTime: false,
    };
  }

  const date = new Date(punch.timestamp);
  const time = toPKTTime(date);
  return {
    direction: punch.direction,
    time,
    secondsOfDay: parseTimeToSeconds(time) ?? 0,
    sortValue: date.getTime(),
    hasAbsoluteTime: true,
  };
}

function minutesBetween(start: NormalizedPunch, end: NormalizedPunch): number {
  if (start.hasAbsoluteTime && end.hasAbsoluteTime) {
    const diff = (end.sortValue - start.sortValue) / 60_000;
    return diff >= 0 ? diff : diff + 24 * 60;
  }

  let diffSeconds = end.secondsOfDay - start.secondsOfDay;
  if (diffSeconds < 0) diffSeconds += 24 * 3600;
  return diffSeconds / 60;
}

function isOvernightShift(shift: Shift): boolean {
  const startSec = parseTimeToSeconds(shift.start);
  const endSec = parseTimeToSeconds(shift.end);
  if (startSec === null || endSec === null) return false;
  return endSec <= startSec;
}

function normalizeForOvernight(
  punchSeconds: number,
  shift: Shift,
  isOut: boolean,
): number {
  const startSec = parseTimeToSeconds(shift.start);
  const endSec = parseTimeToSeconds(shift.end);
  if (startSec === null || endSec === null) return punchSeconds;

  const daySeconds = 24 * 3600;
  if (isOvernightShift(shift)) {
    if (isOut) {
      if (punchSeconds < endSec || punchSeconds < startSec) {
        return punchSeconds + daySeconds;
      }
    } else {
      if (punchSeconds < endSec) {
        return punchSeconds + daySeconds;
      }
    }
  }
  return punchSeconds;
}

function computeShiftViolations(
  inPunches: NormalizedPunch[],
  outPunches: NormalizedPunch[],
  shifts: Shift[],
  graceMinutes: number,
): ShiftViolation[] {
  if (shifts.length === 0) return [];

  const violations: ShiftViolation[] = [];

  for (let i = 0; i < shifts.length; i++) {
    const shift = shifts[i];
    const expectedInSec = parseTimeToSeconds(shift.start);
    const expectedOutSec = parseTimeToSeconds(shift.end);
    if (expectedInSec === null || expectedOutSec === null) continue;

    const actualIn = inPunches[i] ?? null;
    const actualOut = outPunches[i] ?? null;

    let late = false;
    let earlyDeparture = false;

    if (actualIn) {
      const actualInSec = normalizeForOvernight(actualIn.secondsOfDay, shift, false);
      late = actualInSec > expectedInSec + graceMinutes * 60;
    } else {
      late = false;
    }

    if (actualOut) {
      const actualOutSec = normalizeForOvernight(actualOut.secondsOfDay, shift, true);
      const expectedOutNorm = isOvernightShift(shift)
        ? expectedOutSec + 24 * 3600
        : expectedOutSec;
      earlyDeparture = actualOutSec < expectedOutNorm;
    } else if (actualIn) {
      earlyDeparture = true;
    } else {
      late = true;
      earlyDeparture = true;
    }

    violations.push({
      shiftIndex: i,
      late,
      earlyDeparture,
      expectedIn: shift.start,
      actualIn: actualIn?.time,
      expectedOut: shift.end,
      actualOut: actualOut?.time,
    });
  }

  return violations;
}

export function computeAttendanceFromPunches(
  punches: Punch[],
  opts: RecomputeOptions,
): RecomputeResult {
  const normalized = punches
    .map((punch, index) => normalizePunch(punch, index))
    .filter((punch) => Number.isFinite(punch.sortValue))
    .sort((a, b) => a.sortValue - b.sortValue);

  const firstIn = normalized.find((punch) => punch.direction === "in") ?? null;
  const lastPunch = normalized.at(-1) ?? null;
  const lastOut = [...normalized].reverse().find((punch) => punch.direction === "out") ?? null;
  const openIns: NormalizedPunch[] = [];
  let dutyMinutes = 0;

  const inPunches: NormalizedPunch[] = [];
  const outPunches: NormalizedPunch[] = [];

  for (const punch of normalized) {
    if (punch.direction === "in") {
      openIns.push(punch);
      inPunches.push(punch);
    } else {
      const matchingIn = openIns.shift();
      if (matchingIn) {
        dutyMinutes += minutesBetween(matchingIn, punch);
      }
      outPunches.push(punch);
    }
  }

  const checkIn = firstIn?.time ?? null;
  const checkOut = lastPunch?.direction === "out" ? (lastOut?.time ?? null) : null;
  const isNightShift =
    opts.forceNightShift === true ||
    normalized.some(
      (punch) =>
        punch.direction === "in" &&
        Math.floor(punch.secondsOfDay / 3600) >= opts.nightShiftStartHour,
    );

  const shiftViolations = punches.length === 0
    ? []
    : computeShiftViolations(
        inPunches,
        outPunches,
        opts.shifts,
        opts.graceMinutes,
      );

  const anyLate = opts.shifts.length > 0 && punches.length > 0
    ? shiftViolations.some((v) => v.late)
    : null;
  const anyEarly = opts.shifts.length > 0 && punches.length > 0
    ? shiftViolations.some((v) => v.earlyDeparture)
    : false;

  return {
    checkIn,
    checkOut,
    dutyHours: (Math.max(0, dutyMinutes) / 60).toFixed(2),
    isLate: anyLate,
    isNightShift,
    earlyDepartureStatus: anyEarly ? "pending" : "none",
    openInCount: openIns.length,
    shiftViolations,
  };
}
