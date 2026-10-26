/** Hours HR may apply from the bank to one short present day. */
export function maxCoverHours(input: {
  standardHours: number;
  dutyHours: number;
  balance: number;
  currentCover: number;
}) {
  const shortfall = Math.max(0, input.standardHours - input.dutyHours);
  // The day's own cover is already reserved, so it counts as available again.
  const available = Math.max(0, input.balance + input.currentCover);
  return Math.round(Math.min(shortfall, available) * 100) / 100;
}

/** Cash-outs pay at the overtime rate: basic hourly rate × overtime multiplier. */
export function compCashOutAmount(hours: number, overtimeRatePerHour: number) {
  return Math.round(hours * overtimeRatePerHour * 100) / 100;
}
