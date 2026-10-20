import { parseISO } from "date-fns";

export function isWorkingLeaveDate(date: string, restDays: number[] | null = [0], status?: string) {
  return status !== "holiday" && !(restDays ?? [0]).includes(parseISO(date).getDay());
}

export function assertWorkingLeaveDate(date: string, restDays: number[] | null, status?: string) {
  if (!isWorkingLeaveDate(date, restDays, status)) {
    throw new Error("Leave cannot be charged on a rest day or recorded holiday. Update the calendar or daily status first.");
  }
}
