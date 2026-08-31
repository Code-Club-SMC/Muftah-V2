import { differenceInCalendarDays, parseISO } from "date-fns";
import { toPKTDate, toPKTTime } from "./time";

export type LastPunch = {
  direction: "in" | "out";
  attendanceDate: string;
  timestamp: string;
};

export type BackAttributeOptions = {
  overnightOutBeforeHour: number;
};

export type ResolveAttendanceDateResult = {
  attendanceDate: string;
  direction: "in" | "out";
  isOvernightCheckout: boolean;
  migratedFromDate?: string;
};

function isPreviousDate(date: string, nextDate: string): boolean {
  return differenceInCalendarDays(parseISO(nextDate), parseISO(date)) === 1;
}

export function resolveAttendanceDate(
  incomingTimestamp: Date,
  lastPunch: LastPunch | null,
  opts: BackAttributeOptions,
): ResolveAttendanceDateResult {
  const today = toPKTDate(incomingTimestamp);

  if (!lastPunch || lastPunch.direction === "out") {
    return {
      attendanceDate: today,
      direction: "in",
      isOvernightCheckout: false,
    };
  }

  if (lastPunch.attendanceDate === today) {
    return {
      attendanceDate: today,
      direction: "out",
      isOvernightCheckout: false,
    };
  }

  const incomingHour = Number(toPKTTime(incomingTimestamp).slice(0, 2));
  if (
    isPreviousDate(lastPunch.attendanceDate, today) &&
    incomingHour < opts.overnightOutBeforeHour
  ) {
    return {
      attendanceDate: today,
      direction: "out",
      isOvernightCheckout: true,
      migratedFromDate: lastPunch.attendanceDate,
    };
  }

  return {
    attendanceDate: today,
    direction: "in",
    isOvernightCheckout: false,
  };
}

