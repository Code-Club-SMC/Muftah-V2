import {
  format,
  parseISO,
  addMonths,
  setDate,
} from "date-fns";

// ============================================================================
// TYPES
// ============================================================================

export type PayrollCycle = {
  /** The payroll slip label — the month the 25th payout occurs in. e.g. "March 2026" */
  slipLabel: string;
  /** ISO string: first day of the pay period. Always the 16th of the prior month. */
  cycleStart: string;
  /** ISO string: last day of the pay period. Always the 15th of the payout month. */
  cycleEnd: string;
  /** ISO string: the fixed payout date. Always the 25th of the payout month. */
  payoutDate: string;
  /** The payout month string in YYYY-MM format — used as the payroll record key. */
  payoutMonthKey: string;
};

export type PayrollPeriod = {
  /** Stored payroll month date. Always first day of payout month. */
  month: string;
  /** YYYY-MM payout month key. */
  monthKey: string;
  startDate: string;
  endDate: string;
  payoutDate: string;
};

export type ProRataResult = {
  /** The effective start of the employee's work window (max of cycleStart and joiningDate). */
  effectiveStart: string;
  /** Same as cycleEnd — where their slot ends. */
  effectiveEnd: string;
  /** Calendar days from effectiveStart to effectiveEnd inclusive. */
  payableDays: number;
  /** Calendar days in the full cycle (cycleStart to cycleEnd). */
  totalCycleDays: number;
  /** payableDays / totalCycleDays — multiply base pay by this ratio. */
  proRataRatio: number;
  /** True if the employee joined after cycleStart. */
  isProRata: boolean;
};

// ============================================================================
// CORE CYCLE CALCULATOR
// ============================================================================

/**
 * Given a payout year and month (1-indexed), returns the full cycle definition.
 *
 * Example: getCycleForPayoutMonth(2026, 3) → "March 2026"
 *   cycleStart  = 2026-02-16
 *   cycleEnd    = 2026-03-15
 *   payoutDate  = 2026-03-25
 *   slipLabel   = "March 2026"
 */
export function getCycleForPayoutMonth(
  year: number,
  month: number, // 1 = January, 12 = December
): PayrollCycle {
  // The payout month — where the 25th sits
  const payoutMonthDate = new Date(year, month - 1, 1);

  // Cycle starts on the 16th of the previous calendar month
  const prevMonth = addMonths(payoutMonthDate, -1);
  const cycleStart = setDate(prevMonth, 16);

  // Cycle ends on the 15th of the payout month
  const cycleEnd = setDate(payoutMonthDate, 15);

  // Payout is strictly the 25th of the payout month
  const payoutDate = setDate(payoutMonthDate, 25);

  return {
    slipLabel: format(payoutMonthDate, "MMMM yyyy"),
    cycleStart: format(cycleStart, "yyyy-MM-dd"),
    cycleEnd: format(cycleEnd, "yyyy-MM-dd"),
    payoutDate: format(payoutDate, "yyyy-MM-dd"),
    payoutMonthKey: format(payoutMonthDate, "yyyy-MM"),
  };
}

/**
 * Returns the active cycle for the current date.
 *
 * If today is between the 16th and end-of-month, we are in the grace/processing
 * window — i.e. in between settling the current cycle and opening the next.
 * The "active" cycle is still the one whose payout falls in the current month.
 *
 * If today is between the 1st and 15th, the active payout month is the current month.
 * If today is between the 16th and 25th (grace period), payout month is still current month.
 * After the 25th (payout done), the active payout month shifts to next month.
 */
export function getCurrentActiveCycle(date: Date = new Date()): PayrollCycle {
  const today = date;
  const day = today.getDate();
  const month = today.getMonth() + 1; // 1-indexed
  const year = today.getFullYear();

  // After 25th, the current cycle is already paid — next payout month is active
  if (day > 25) {
    const nextMonth = addMonths(new Date(year, month - 1, 1), 1);
    return getCycleForPayoutMonth(
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1,
    );
  }

  return getCycleForPayoutMonth(year, month);
}

/**
 * Returns true if `date` falls within the processing/grace window:
 * the 16th to the 25th of any month (inclusive).
 * During this period no new pay-cycle days accrue.
 */
export function isInGracePeriod(date: Date = new Date()): boolean {
  const day = date.getDate();
  return day >= 16 && day <= 25;
}

/**
 * Derives a PayrollCycle from a "YYYY-MM" payroll month key.
 * The month key is the payout month.
 *
 * e.g. "2026-03" → March 2026 cycle (Feb 16 – Mar 15, paid Mar 25)
 */
export function getCycleFromMonthKey(monthKey: string): PayrollCycle {
  const [year, month] = monthKey.split("-").map(Number);
  return getCycleForPayoutMonth(year, month);
}

export function getPayrollPeriodForMonthKey(monthKey: string): PayrollPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Error("Payroll month must be in YYYY-MM format");
  }

  const cycle = getCycleFromMonthKey(monthKey);
  return {
    month: `${monthKey}-01`,
    monthKey,
    startDate: cycle.cycleStart,
    endDate: cycle.cycleEnd,
    payoutDate: cycle.payoutDate,
  };
}

export function getPayrollPeriodFromStoredMonth(month: string): PayrollPeriod {
  return getPayrollPeriodForMonthKey(month.substring(0, 7));
}

export function getPayrollPeriodFromMonthInput(month: string): PayrollPeriod {
  return getPayrollPeriodForMonthKey(month.substring(0, 7));
}

// ============================================================================
// PRO-RATA CALCULATION
// ============================================================================

/**
 * Computes the effective payable date range and ratio for a mid-cycle hire.
 *
 * If joiningDate <= cycleStart: full cycle (isProRata = false, ratio = 1.0)
 * If joiningDate > cycleEnd:    not eligible (ratio = 0, payableDays = 0)
 * Otherwise:                    pro-rata slice from joiningDate to cycleEnd
 */
export function computeProRataRange(
  cycleStart: string,
  cycleEnd: string,
  joiningDate: string,
): ProRataResult {
  const start = parseISO(cycleStart);
  const end = parseISO(cycleEnd);
  const joinDate = parseISO(joiningDate);

  const totalCycleDays =
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  // Employee joined before or on cycle start — full pay
  if (joinDate <= start) {
    return {
      effectiveStart: cycleStart,
      effectiveEnd: cycleEnd,
      payableDays: totalCycleDays,
      totalCycleDays,
      proRataRatio: 1.0,
      isProRata: false,
    };
  }

  // Employee joins after the cycle ends — not eligible this cycle
  if (joinDate > end) {
    return {
      effectiveStart: cycleEnd,
      effectiveEnd: cycleEnd,
      payableDays: 0,
      totalCycleDays,
      proRataRatio: 0,
      isProRata: true,
    };
  }

  // Partial cycle: joinDate falls within the cycle
  const payableDays =
    Math.round((end.getTime() - joinDate.getTime()) / 86_400_000) + 1;
  const proRataRatio = +(payableDays / totalCycleDays).toFixed(6);

  return {
    effectiveStart: format(joinDate, "yyyy-MM-dd"),
    effectiveEnd: cycleEnd,
    payableDays,
    totalCycleDays,
    proRataRatio,
    isProRata: true,
  };
}

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

/** Human-readable cycle range string, e.g. "Feb 16 – Mar 15, 2026" */
export function formatCycleRange(cycle: PayrollCycle): string {
  const start = parseISO(cycle.cycleStart);
  const end = parseISO(cycle.cycleEnd);
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

/** Days remaining in the current cycle as of today */
export function daysRemainingInCycle(cycle: PayrollCycle, date: Date = new Date()): number {
  const today = date;
  const end = parseISO(cycle.cycleEnd);
  const diff = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

/** Returns cycle progress as a percentage (0–100) */
export function cycleProgressPercent(cycle: PayrollCycle, date: Date = new Date()): number {
  const start = parseISO(cycle.cycleStart);
  const end = parseISO(cycle.cycleEnd);
  const today = date;
  const total = end.getTime() - start.getTime();
  const elapsed = Math.min(today.getTime() - start.getTime(), total);
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}
