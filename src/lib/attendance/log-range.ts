import { getCycleFromMonthKey } from "@/lib/payroll-cycle";
import { nowPKTDate } from "./time";

/**
 * Dates an attendance log opens with: the payroll month of the given or current calendar month.
 * In November that is 16 Oct to 15 Nov, also after the 15th.
 */
export function attendanceLogRange(month = nowPKTDate().slice(0, 7)) {
  const { cycleStart, cycleEnd } = getCycleFromMonthKey(month);
  return { startDate: cycleStart, endDate: cycleEnd };
}
