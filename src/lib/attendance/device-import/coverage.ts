import { formatCycleRange, getCycleForPayoutMonth } from "@/lib/payroll-cycle";

export type DeviceImportCycleGap = {
  /** Payout month label, e.g. "October 2026". */
  label: string;
  range: string;
  startDate: string;
  endDate: string;
  /** Contiguous runs of past cycle dates with no report row and no saved attendance. */
  missingRanges: { start: string; end: string }[];
  missingDayCount: number;
};

const shiftDate = (date: string, days: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

// Payroll months run from the 16th to the 15th, paid in the month holding the 15th.
export function payrollCycleForDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const payout = day >= 16 ? month + 1 : month;
  return payout > 12
    ? getCycleForPayoutMonth(year + 1, 1)
    : getCycleForPayoutMonth(year, payout);
}

export function payrollCyclesForDates(dates: string[]) {
  const cycles = new Map(
    dates.map((date) => {
      const cycle = payrollCycleForDate(date);
      return [cycle.payoutMonthKey, cycle];
    }),
  );
  return [...cycles.values()].sort((a, b) =>
    a.cycleStart.localeCompare(b.cycleStart),
  );
}

/**
 * Finds dates in the payroll months a report touches that neither the report
 * nor saved attendance covers. Only dates before `today` count, so a running
 * month is not flagged for days that have not happened yet.
 */
export function findPayrollCycleGaps(input: {
  reportDates: string[];
  recordedDates: string[];
  today: string;
}): DeviceImportCycleGap[] {
  const covered = new Set([...input.reportDates, ...input.recordedDates]);
  const gaps: DeviceImportCycleGap[] = [];
  for (const cycle of payrollCyclesForDates(input.reportDates)) {
    const missingRanges: DeviceImportCycleGap["missingRanges"] = [];
    let missingDayCount = 0;
    for (
      let date = cycle.cycleStart;
      date <= cycle.cycleEnd && date < input.today;
      date = shiftDate(date, 1)
    ) {
      if (covered.has(date)) continue;
      missingDayCount++;
      const last = missingRanges.at(-1);
      if (last && shiftDate(last.end, 1) === date) last.end = date;
      else missingRanges.push({ start: date, end: date });
    }
    if (missingDayCount)
      gaps.push({
        label: cycle.slipLabel,
        range: formatCycleRange(cycle),
        startDate: cycle.cycleStart,
        endDate: cycle.cycleEnd,
        missingRanges,
        missingDayCount,
      });
  }
  return gaps;
}
