import {
  splitShortHoursByTimeExceptions,
  type PayrollTimeException,
} from "./time-exceptions";

/**
 * Hours HR may apply from the bank to one short present day.
 * Only short hours that cost pay count: plain undertime plus rejected late or
 * early minutes. Excused, company-work, pending and grace minutes are already free.
 */
export function maxCoverHours(input: {
  standardHours: number;
  dutyHours: number;
  balance: number;
  currentCover: number;
  timeExceptions?: PayrollTimeException[];
}) {
  const short = Math.max(0, input.standardHours - input.dutyHours);
  const items = input.timeExceptions ?? [];
  let shortfall = short;
  if (items.length && short > 0) {
    const split = splitShortHoursByTimeExceptions(short, items);
    shortfall = split.lateHours + split.earlyHours + split.undertimeHours;
  }
  // The day's own cover is already reserved, so it counts as available again.
  const available = Math.max(0, input.balance + input.currentCover);
  return Math.round(Math.min(shortfall, available) * 100) / 100;
}

/** Cash-outs pay at the overtime rate: basic hourly rate × overtime multiplier. */
export function compCashOutAmount(hours: number, overtimeRatePerHour: number) {
  return Math.round(hours * overtimeRatePerHour * 100) / 100;
}
