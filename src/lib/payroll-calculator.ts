import { calculateTotalShiftHours } from "./attendance/time";
import { parseISO, eachDayOfInterval, format } from "date-fns";
import {
  DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
  type AllowanceConfig,
  type BasicSalaryDeductionPolicy,
  type AttendanceDeductionAdjustments,
} from "@/lib/types/hr-types";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type AttendanceRecord = {
  date: string;
  status: "present" | "absent" | "leave" | "holiday" | "not_employed";
  dutyHours: string | null;
  overtimeHours: string | null;
  isNightShift: boolean;
  overtimeCompensationMethod?: "payout" | "comp_off";
  compensatoryHoursUsed?: string | null;
  /**
   * true  → approved paid leave (no deduction)
   * false → unpaid / unapproved leave (conveyance deducted per existing rule)
   */
  isApprovedLeave?: boolean;
  /**
   * Type of leave — used for Bradford Factor and leave balance deduction.
   * sick | annual | special  (casual removed from UI; kept in type for backward compat)
   */
  leaveType?: string | null;
  /**
   * Only count overtime when the admin has explicitly approved it.
   * pending | approved | rejected
   */
  overtimeStatus?: string;
  isLate?: boolean;
  earlyDepartureStatus?: string; // none, pending, approved, rejected
};

export type EmployeeData = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  cnic: string | null;
  designation: string;
  joiningDate?: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  basicSalary: string;
  allowanceConfig: AllowanceConfig[];
  standardDutyHours?: number; // fallback to 8 if absent
  shifts?: { start: string; end: string }[] | null;
  /**
   * Days of the week treated as non-working rest days.
   * 0 = Sunday, 1 = Monday, ..., 6 = Saturday
   * Default: [0] (Sunday only)
   */
  restDays?: number[];
  basicSalaryDeductionPolicy?: BasicSalaryDeductionPolicy | null;
};

export type DeductionConfig = {
  manualDeductions: Array<{
    description: string;
    amount: number;
  }>;
  deductConveyanceOnLeave: boolean; // kept for backward compat, now only applies to unapproved leave
};

export type PayslipCalculation = {
  // Employee Info
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  cnic: string;
  bankName: string;
  bankAccountNumber: string;

  // Period
  payrollMonth: string;
  startDate: string;
  endDate: string;

  // Attendance Summary
  totalWorkingDays: number;
  daysPresent: number;
  daysAbsent: number;
  daysLeave: number; // approved paid leaves
  daysUnapprovedLeave: number; // unpaid / unapproved (kept for internal calcs; hidden from UI)
  daysSickLeave: number;
  daysCasualLeave: number; // kept for backward compat; hidden from UI
  daysAnnualLeave: number;
  daysSpecialLeave: number;
  daysNotEmployed: number; // Days outside of joining/cutoff
  unmarkedDays: number; // dynamically computed missing days on working days only
  totalOvertimeHours: number;
  totalUndertimeHours: number;
  nightShiftsCount: number;
  bradfordFactorScore: number;
  bradfordFactorPeriod: string;

  // Earnings
  basicSalary: number;
  allowanceBreakdown: Record<string, number>;

  overtimeAmount: number;
  nightShiftAllowanceAmount: number;
  incentiveAmount: number;
  commissionAmount: number;
  bonusAmount: number;

  // Deductions
  notEmployedDeduction: number; // Money deducted for pre-joining or post-cutoff
  absentDeduction: number;
  leaveDeduction: number;
  advanceDeduction: number;
  taxDeduction: number;
  manualDeductions: Array<{ description: string; amount: number }>;
  otherDeduction: number;

  // Original Standard Snapshot
  standardBreakdown: Record<string, number>;

  // Post-attendance Component Breakdowns
  adjustedBreakdown: Record<string, number>;
  componentDeductions: Record<string, number>;
  deductionBreakdownByOccasion: {
    absent: number;
    undertime: number;
    specialLeave: number;
    sickLeave: number;
    annualLeave: number;
    unapprovedLeave: number;
    notEmployed: number;
  };
  unadjustedOccasionDeductions?: {
    absent: number;
    undertime: number;
    specialLeave: number;
    sickLeave: number;
    annualLeave: number;
    unapprovedLeave: number;
    notEmployed: number;
  };
  allowanceNames: Record<string, string>;
  fixedComponents: Record<string, boolean>;
  attendanceAdjustments?: AttendanceDeductionAdjustments;

  calculationMeta: {
    calendarDaysInMonth: number;
    perDayBasic: number;
    perHourBasic: number;
    overtimeMultiplier: number;
    overtimeRatePerHour: number;
    standardDutyHours: number;
    restDays: number[]; // surfaced for transparency / debugging
  };

  // Totals
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
  paymentSource: string | null;

  // Meta
  remarks: string;

  // Arrears helpers (populated by server fn)
  missedLastMonth?: boolean;
  lastMonthStandardSalary?: string;

  // Yearly Bradford (calendar year Jan–Dec, populated by server fn)
  yearlyBradfordScore?: number;

  // Annual leave (populated by server fn)
  annualLeaveRemaining?: number;
  annualLeaveAllowance?: number;
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Returns the day-of-week numbers (0=Sun … 6=Sat) for every day in
 * the given interval that is NOT a configured rest day and NOT an
 * admin-marked holiday.
 *
 * This is the single source of truth for "how many days does this
 * employee actually owe work in this pay cycle?"
 */
export function calculateWorkingDays(
  startDate: string,
  endDate: string,
  records: AttendanceRecord[],
  restDays: number[] = [0], // 0 = Sunday by default
): number {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const allDaysInCycle = eachDayOfInterval({ start, end });

  // 1. Strip out configured rest days (Sunday, Saturday, etc.)
  const nonRestDays = allDaysInCycle.filter(
    (d) => !restDays.includes(d.getDay()),
  );

  // 2. Strip any days explicitly marked as 'holiday' by admin / system
  const holidayDates = new Set(
    records
      .filter((r) => r.status === "holiday")
      .map((r) => r.date),
  );
  const trueWorkingDays = nonRestDays.filter(
    (d) => !holidayDates.has(format(d, "yyyy-MM-dd")),
  );

  return Math.max(1, trueWorkingDays.length); // Guard against division-by-zero
}

/**
 * Builds a Set of ISO date strings that are rest days within the given range.
 * Used to filter attendance records so rest-day entries never distort
 * the summary counts or the unmarked-days alarm.
 */
export function buildRestDayDateSet(
  startDate: string,
  endDate: string,
  restDays: number[],
): Set<string> {
  if (restDays.length === 0) return new Set();
  const allDays = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate),
  });
  return new Set(
    allDays
      .filter((d) => restDays.includes(d.getDay()))
      .map((d) => format(d, "yyyy-MM-dd")),
  );
}

export function getCalendarDaysInPayPeriodMonth(
  totalWorkingDays: number,
): number {
  return totalWorkingDays;
}

function getAllowanceAmount(config: AllowanceConfig[], id: string): number {
  return config.find((a) => a.id === id)?.amount || 0;
}

// ============================================================================
// DEDUCTION CALCULATION
// ============================================================================

/**
 * Deduction rules:
 *
 * 1. ABSENT (no notice): full-day deduction — Basic + all allowances except Fuel & Special.
 * 2. APPROVED LEAVE: NO deduction at all.
 * 3. UNAPPROVED / UNPAID LEAVE: Deduct Conveyance only.
 * 4. UNDERTIME (present but short hours): hour-based deduction from Basic only.
 *
 * NOTE: records passed here must already be filtered to working days only
 * (no rest-day entries, no holiday entries) by the caller.
 */
export function calculateAbsentDeductions(
  employee: EmployeeData,
  attendanceRecords: AttendanceRecord[],
  calendarDaysInMonth: number,
  adjustmentsConfig?: AttendanceDeductionAdjustments,
): {
  absentDeduction: number;
  leaveDeduction: number;
  notEmployedDeduction: number;
  totalUndertimeHours: number;
  adjustedAllowances: Record<string, number>;
  componentDeductions: Record<string, number>;
  deductionBreakdownByOccasion: {
    absent: number;
    undertime: number;
    specialLeave: number;
    sickLeave: number;
    annualLeave: number;
    unapprovedLeave: number;
    notEmployed: number;
  };
  unadjustedOccasionDeductions: {
    absent: number;
    undertime: number;
    specialLeave: number;
    sickLeave: number;
    annualLeave: number;
    unapprovedLeave: number;
    notEmployed: number;
  };
} {
  const shiftHours = calculateTotalShiftHours(employee.shifts);
  const standardDutyHours = shiftHours > 0 ? shiftHours : (employee.standardDutyHours || 8);
  const config = employee.allowanceConfig || [];
  const basicPolicy = {
    ...DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
    ...(employee.basicSalaryDeductionPolicy ?? {}),
  };

  const basicSalary = parseFloat(employee.basicSalary || "0");
  const perDayBasic = basicSalary / calendarDaysInMonth;
  const perHourBasic = perDayBasic / standardDutyHours;

  let totalUndertimeHours = 0;

  const deductionBreakdownByOccasion = {
    absent: 0,
    undertime: 0,
    specialLeave: 0,
    sickLeave: 0,
    annualLeave: 0,
    unapprovedLeave: 0,
    notEmployed: 0,
  };

  const unadjustedOccasionDeductions = {
    absent: 0,
    undertime: 0,
    specialLeave: 0,
    sickLeave: 0,
    annualLeave: 0,
    unapprovedLeave: 0,
    notEmployed: 0,
  };

  // Track component deductions per occasion bucket to allow proportional scaling when custom overrides are applied
  const componentOccasionDeductions: Record<string, Record<string, number>> = {
    basicSalary: {},
  };
  for (const a of config) {
    componentOccasionDeductions[a.id] = {};
  }

  const isOccasionWaived = (bucket: keyof typeof deductionBreakdownByOccasion) => {
    if (bucket === "notEmployed") {
      return false; // Proration for pre-joining/cutoff is not waived by default
    }
    if (adjustmentsConfig?.waiveAll) {
      return true;
    }
    if (bucket === "absent" && adjustmentsConfig?.waiveAbsent) return true;
    if (bucket === "undertime" && adjustmentsConfig?.waiveUndertime) return true;
    if (bucket === "specialLeave" && adjustmentsConfig?.waiveSpecialLeave) return true;
    if (bucket === "sickLeave" && adjustmentsConfig?.waiveSickLeave) return true;
    if (bucket === "annualLeave" && adjustmentsConfig?.waiveAnnualLeave) return true;
    if (bucket === "unapprovedLeave" && adjustmentsConfig?.waiveUnapprovedLeave) return true;
    return false;
  };

  const deductBasicPolicy = (
    occasion:
      | "absent"
      | "not_employed"
      | "annualLeave"
      | "sickLeave"
      | "specialLeave"
      | "lateArrival"
      | "earlyLeaving",
  ) => {
    if (occasion === "not_employed") return basicPolicy.notEmployed;
    return basicPolicy[occasion] ?? false;
  };

  const applyOccasionDeduction = (
    fraction: number,
    occasion:
      | "absent"
      | "not_employed"
      | "annualLeave"
      | "sickLeave"
      | "specialLeave"
      | "lateArrival"
      | "earlyLeaving"
      | "undertime",
    _deductionTarget: "absent" | "leave" | "not_employed" = "absent",
    occasionBucket: keyof typeof deductionBreakdownByOccasion = "absent",
  ) => {
    const isHourlyOccasion =
      occasion === "lateArrival" || occasion === "earlyLeaving" || occasion === "undertime";

    // 1. Basic Salary deduction
    let shouldDeductBasic = false;
    if (occasion === "undertime") {
      shouldDeductBasic = deductBasicPolicy("lateArrival") || deductBasicPolicy("earlyLeaving");
    } else {
      shouldDeductBasic = deductBasicPolicy(occasion);
    }

    const basicDeduction = shouldDeductBasic
      ? (isHourlyOccasion ? perHourBasic * fraction : perDayBasic * fraction)
      : 0;
    unadjustedOccasionDeductions[occasionBucket] += basicDeduction;

    // 2. Allowance deductions
    let allowanceOccasionTotal = 0;
    for (const allowance of config) {
      let shouldDeduct = false;
      if (occasion === "not_employed") {
        shouldDeduct = true; // Always prorate all allowances if not employed
      } else if (occasion === "undertime") {
        shouldDeduct =
          (allowance.deductions?.lateArrival ?? false) ||
          (allowance.deductions?.earlyLeaving ?? false);
      } else {
        shouldDeduct = allowance.deductions?.[occasion] ?? false;
      }

      if (shouldDeduct) {
        let amt = 0;
        if (isHourlyOccasion) {
          if (allowance.lateEarlyBasis === "perDay") {
            amt = allowance.amount / calendarDaysInMonth;
          } else {
            const perHourRate =
              allowance.amount / (calendarDaysInMonth * standardDutyHours);
            amt = perHourRate * fraction;
          }
        } else {
          amt = (allowance.amount / calendarDaysInMonth) * fraction;
        }
        allowanceOccasionTotal += amt;
        if (!isOccasionWaived(occasionBucket)) {
          componentOccasionDeductions[allowance.id][occasionBucket] =
            (componentOccasionDeductions[allowance.id][occasionBucket] || 0) + amt;
        }
      }
    }
    unadjustedOccasionDeductions[occasionBucket] += allowanceOccasionTotal;

    if (isOccasionWaived(occasionBucket)) {
      return;
    }

    if (shouldDeductBasic) {
      componentOccasionDeductions["basicSalary"][occasionBucket] =
        (componentOccasionDeductions["basicSalary"][occasionBucket] || 0) + basicDeduction;
      deductionBreakdownByOccasion[occasionBucket] += basicDeduction;
    }
    deductionBreakdownByOccasion[occasionBucket] += allowanceOccasionTotal;
  };

  for (const record of attendanceRecords) {
    const recordDate = parseISO(record.date);
    const dayOfWeek = recordDate.getDay();
    const isRestDay = (employee.restDays ?? [0]).includes(dayOfWeek);

    // Completely skip deductions for rest days to ensure no false penalisation
    if (isRestDay) continue;

    const baseDutyHours = parseFloat(record.dutyHours || "0");
    const compHoursUsed = parseFloat(record.compensatoryHoursUsed || "0");
    const dutyHours = baseDutyHours + compHoursUsed;

    if (record.status === "absent") {
      applyOccasionDeduction(1, "absent", "absent", "absent");
    } else if (record.status === "not_employed") {
      applyOccasionDeduction(1, "not_employed", "not_employed", "notEmployed");
    } else if (record.status === "leave") {
      if (record.leaveType === "special") {
        applyOccasionDeduction(1, "specialLeave", "leave", "specialLeave");
      } else if (record.leaveType === "sick") {
        applyOccasionDeduction(1, "sickLeave", "leave", "sickLeave");
      } else if (record.leaveType === "annual") {
        applyOccasionDeduction(1, "annualLeave", "leave", "annualLeave");
      } else if (!record.isApprovedLeave) {
        applyOccasionDeduction(1, "annualLeave", "leave", "unapprovedLeave");
      }
    } else if (
      record.status === "present" &&
      dutyHours < standardDutyHours
    ) {
      const shortHours = standardDutyHours - dutyHours;
      totalUndertimeHours += shortHours;

      const isLate = record.isLate ?? false;
      const isEarly = (record.earlyDepartureStatus !== "none" && record.earlyDepartureStatus !== null && record.earlyDepartureStatus !== undefined);

      if (isLate && isEarly) {
        applyOccasionDeduction(shortHours, "undertime", "absent", "undertime");
      } else if (isLate) {
        applyOccasionDeduction(shortHours, "lateArrival", "absent", "undertime");
      } else if (isEarly) {
        applyOccasionDeduction(shortHours, "earlyLeaving", "absent", "undertime");
      } else {
        applyOccasionDeduction(shortHours, "undertime", "absent", "undertime");
      }
    }
  }

  // 3. Apply custom amount overrides if HR specified any
  const customOverrides = adjustmentsConfig?.customDeductions;
  if (customOverrides) {
    const buckets = [
      "absent",
      "undertime",
      "specialLeave",
      "sickLeave",
      "annualLeave",
      "unapprovedLeave",
    ] as const;

    for (const bucket of buckets) {
      if (customOverrides[bucket] !== undefined) {
        const targetAmt = Math.max(0, customOverrides[bucket]!);
        const calcAmt = deductionBreakdownByOccasion[bucket];
        if (calcAmt > 0) {
          const scale = targetAmt / calcAmt;
          for (const compId of Object.keys(componentOccasionDeductions)) {
            if (componentOccasionDeductions[compId][bucket]) {
              componentOccasionDeductions[compId][bucket] *= scale;
            }
          }
        } else if (targetAmt > 0) {
          componentOccasionDeductions["basicSalary"][bucket] = targetAmt;
        }
        deductionBreakdownByOccasion[bucket] = targetAmt;
      }
    }
  }

  // 4. Reconcile component deductions and adjusted allowances
  const componentDeductions: Record<string, number> = {};
  const adjustedAllowances: Record<string, number> = {};

  const allComponentIds = ["basicSalary", ...config.map((a) => a.id)];
  for (const compId of allComponentIds) {
    const totalDeducted = Object.values(
      componentOccasionDeductions[compId] || {},
    ).reduce((sum, val) => sum + val, 0);
    const roundedDeducted = Math.round(totalDeducted);
    componentDeductions[compId] = roundedDeducted;

    const stdAmt =
      compId === "basicSalary"
        ? basicSalary
        : (config.find((a) => a.id === compId)?.amount || 0);
    adjustedAllowances[compId] = Math.max(0, Math.round(stdAmt - roundedDeducted));
  }

  const roundedAbsent = Math.round(deductionBreakdownByOccasion.absent);
  const roundedUndertime = Math.round(deductionBreakdownByOccasion.undertime);
  const roundedSpecialLeave = Math.round(deductionBreakdownByOccasion.specialLeave);
  const roundedSickLeave = Math.round(deductionBreakdownByOccasion.sickLeave);
  const roundedAnnualLeave = Math.round(deductionBreakdownByOccasion.annualLeave);
  const roundedUnapprovedLeave = Math.round(deductionBreakdownByOccasion.unapprovedLeave);
  const roundedNotEmployed = Math.round(deductionBreakdownByOccasion.notEmployed);

  const totalComponentSum = Object.values(componentDeductions).reduce((s, v) => s + v, 0);
  const occasionSum =
    roundedAbsent +
    roundedUndertime +
    roundedSpecialLeave +
    roundedSickLeave +
    roundedAnnualLeave +
    roundedUnapprovedLeave +
    roundedNotEmployed;

  const occasionDelta = totalComponentSum - occasionSum;
  let finalAbsent = roundedAbsent;
  let finalUndertime = roundedUndertime;

  if (occasionDelta !== 0) {
    if (finalUndertime > 0) {
      finalUndertime += occasionDelta;
    } else if (finalAbsent > 0) {
      finalAbsent += occasionDelta;
    }
  }

  return {
    absentDeduction: finalAbsent + finalUndertime,
    leaveDeduction: roundedSpecialLeave + roundedSickLeave + roundedAnnualLeave + roundedUnapprovedLeave,
    notEmployedDeduction: roundedNotEmployed,
    totalUndertimeHours: +totalUndertimeHours.toFixed(2),
    adjustedAllowances,
    componentDeductions,
    deductionBreakdownByOccasion: {
      absent: finalAbsent,
      undertime: finalUndertime,
      specialLeave: roundedSpecialLeave,
      sickLeave: roundedSickLeave,
      annualLeave: roundedAnnualLeave,
      unapprovedLeave: roundedUnapprovedLeave,
      notEmployed: roundedNotEmployed,
    },
    unadjustedOccasionDeductions: {
      absent: Math.round(unadjustedOccasionDeductions.absent),
      undertime: Math.round(unadjustedOccasionDeductions.undertime),
      specialLeave: Math.round(unadjustedOccasionDeductions.specialLeave),
      sickLeave: Math.round(unadjustedOccasionDeductions.sickLeave),
      annualLeave: Math.round(unadjustedOccasionDeductions.annualLeave),
      unapprovedLeave: Math.round(unadjustedOccasionDeductions.unapprovedLeave),
      notEmployed: Math.round(unadjustedOccasionDeductions.notEmployed),
    },
  };
}

// ============================================================================
// OVERTIME
// ============================================================================

/**
 * Only count overtime hours where overtimeStatus === "approved".
 */
export function sumApprovedOvertimeHours(records: AttendanceRecord[]): number {
  return records.reduce((sum, r) => {
    if (r.overtimeStatus !== "approved") return sum;
    if (r.overtimeCompensationMethod === "comp_off") return sum;
    return sum + parseFloat(r.overtimeHours || "0");
  }, 0);
}


export function calculateOvertimePay(
  basicSalary: number,
  standardDutyHours: number,
  calendarDaysInMonth: number,
  overtimeHours: number,
  multiplier: number = 1.0,
): number {
  const perDayBasic = basicSalary / calendarDaysInMonth;
  const perHourBasic = perDayBasic / standardDutyHours;
  return Math.round(perHourBasic * multiplier * overtimeHours);
}

// ============================================================================
// BRADFORD FACTOR
// ============================================================================

/**
 * Bradford Factor: B = S² × D
 *
 * S = number of separate absence SPELLS (consecutive absents = 1 spell)
 * D = total absent-equivalent days
 *
 * What counts:
 *   - absent                   → full day, full spell counting
 *   - sick leave               → counts toward D
 *   - unpaid / special leave   → counts toward D
 *   - approved paid leaves     → excluded
 *
 * Rest days are excluded from Bradford (they are passed in pre-filtered).
 */
export function calculateBradfordFactor(
  attendanceRecords: AttendanceRecord[],
): number {
  let spells = 0;
  let totalAbsentDays = 0;
  let inSpell = false;

  const sorted = [...attendanceRecords].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  for (const record of sorted) {
    const isBradfordEvent =
      record.status === "absent" ||
      (record.status === "leave" &&
        (record.leaveType === "sick" ||
          record.leaveType === "special" ||
          record.leaveType === "unpaid" ||
          !record.isApprovedLeave));

    if (isBradfordEvent) {
      totalAbsentDays += 1;
      if (!inSpell) {
        spells++;
        inSpell = true;
      }
    } else {
      inSpell = false;
    }
  }

  return Math.round(Math.pow(spells, 2) * totalAbsentDays);
}

/**
 * Yearly Bradford Factor: same S² × D formula but evaluated across
 * ALL attendance records from Jan 1 to Dec 31 of a given calendar year.
 *
 * Pass the full year's attendance to get the cumulative score.
 * Auto-resets on Jan 1 each year because the previous year's records
 * are no longer included in the query window.
 */
export function calculateYearlyBradfordFactor(
  allYearRecords: AttendanceRecord[],
): number {
  return calculateBradfordFactor(allYearRecords);
}

// ============================================================================
// MAIN PAYSLIP CALCULATOR
// ============================================================================

export function calculatePayslip(
  employee: EmployeeData,
  attendanceRecords: AttendanceRecord[],
  payrollPeriod: { month: string; startDate: string; endDate: string },
  deductionConfig: DeductionConfig = {
    manualDeductions: [],
    deductConveyanceOnLeave: true,
  },
  additionalAmounts: {
    overtimeAmount?: number;
    nightShiftAllowance?: number;
    incentiveAmount?: number;
    commissionAmount?: number;
    bonusAmount?: number;
    advanceDeduction?: number;
    taxDeduction?: number;
    overtimeMultiplier?: number;
  } = {},
  earlyCutoffDate?: string,
  attendanceAdjustments?: AttendanceDeductionAdjustments,
): PayslipCalculation {
  const stdDutyHours = employee.standardDutyHours || 8;
  const config = employee.allowanceConfig || [];
  const basicSalaryStd = parseFloat(employee.basicSalary || "0");
  const restDays = employee.restDays ?? [0];

  let joinedAtDate: string | null = null;
  if (employee.joiningDate) {
    const d = parseISO(employee.joiningDate);
    if (!isNaN(d.getTime())) {
      joinedAtDate = format(d, "yyyy-MM-dd");
    }
  }

  // 1. Build a set of rest-day dates in this cycle
  const restDayDateSet = buildRestDayDateSet(
    payrollPeriod.startDate,
    payrollPeriod.endDate,
    restDays,
  );

  // 2. Evaluation window
  const evaluationStartDate = joinedAtDate && joinedAtDate > payrollPeriod.startDate 
    ? joinedAtDate 
    : payrollPeriod.startDate;
  const evaluationEndDate = earlyCutoffDate ? earlyCutoffDate : payrollPeriod.endDate;

  // 3. Full Cycle Denominator
  const fullCycleWorkingDays = calculateWorkingDays(
    payrollPeriod.startDate,
    payrollPeriod.endDate,
    attendanceRecords,
    restDays,
  );
  const calendarDaysInMonth = getCalendarDaysInPayPeriodMonth(fullCycleWorkingDays);

  const holidayDateSet = new Set(
    attendanceRecords
      .filter((record) => record.status === "holiday")
      .map((record) => record.date),
  );

  // 5. Build WorkingDayRecords. Future/cutoff days are not misconduct; the
  // server must explicitly pass earlyCutoffDate when generating a partial slip.
  const workingDayRecords = attendanceRecords.filter(
    (r) => !restDayDateSet.has(r.date) && r.status !== "holiday",
  ).map(r => {
    if (joinedAtDate && r.date < joinedAtDate) {
      return { ...r, status: "not_employed" as const };
    }
    return r;
  }).filter((r) => !earlyCutoffDate || r.date <= earlyCutoffDate);

  // Inject virtual not-employed records for missing pre-joining days and
  // post-cutoff days so both use the same deduction policy.
  const start = parseISO(payrollPeriod.startDate);
  const end = parseISO(payrollPeriod.endDate);
  const cycleRange = eachDayOfInterval({ start, end });
  const accountedWorkingDates = new Set(workingDayRecords.map((r) => r.date));
  for (const day of cycleRange) {
    const dateStr = format(day, "yyyy-MM-dd");
    const isPreJoining = !!joinedAtDate && dateStr < joinedAtDate;
    const isPostCutoff = !!earlyCutoffDate && dateStr > earlyCutoffDate;
    if (
      !restDayDateSet.has(dateStr) &&
      !holidayDateSet.has(dateStr) &&
      !accountedWorkingDates.has(dateStr) &&
      (isPreJoining || isPostCutoff)
    ) {
      workingDayRecords.push({
        date: dateStr,
        status: "not_employed",
        dutyHours: null,
        overtimeHours: null,
        isNightShift: false,
      });
      accountedWorkingDates.add(dateStr);
    }
  }

  // 6. Attendance Summary
  // Unmarked only counts gaps in the window (<= cutoff && >= joined)
  // evaluationWindowWorkingDays is the number of working days the employee was *expected* to work.
  const evaluationWindowWorkingDays = calculateWorkingDays(
    evaluationStartDate,
    evaluationEndDate,
    attendanceRecords,
    restDays,
  );
  const pastRecords = workingDayRecords.filter(r => r.date <= evaluationEndDate && r.date >= evaluationStartDate);
  const accountedPastDays = pastRecords.filter(r => ["present", "absent", "leave", "not_employed"].includes(r.status)).length;
  const unmarkedDays = Math.max(0, evaluationWindowWorkingDays - accountedPastDays);

  const daysPresent = workingDayRecords.filter(r => r.status === "present").length;
  const daysAbsent = workingDayRecords.filter(r => r.status === "absent").length;
  const daysLeave = workingDayRecords.filter(r => r.status === "leave" && r.isApprovedLeave).length;
  const daysUnapprovedLeave = workingDayRecords.filter(r => r.status === "leave" && !r.isApprovedLeave).length;
  const daysSickLeave = workingDayRecords.filter(r => r.status === "leave" && r.leaveType === "sick").length;
  const daysCasualLeave = workingDayRecords.filter(r => r.status === "leave" && r.leaveType === "casual").length;
  const daysAnnualLeave = workingDayRecords.filter(r => r.status === "leave" && r.leaveType === "annual").length;
  const daysSpecialLeave = workingDayRecords.filter(r => r.status === "leave" && r.leaveType === "special").length;
  const daysNotEmployed = workingDayRecords.filter(r => r.status === "not_employed").length;

  const validEvaluationRecords = workingDayRecords.filter(r => r.date >= evaluationStartDate && r.date <= evaluationEndDate);
  const totalOvertimeHours = sumApprovedOvertimeHours(validEvaluationRecords);
  const nightShiftsCount = validEvaluationRecords.filter(
    (r) => r.status === "present" && r.isNightShift,
  ).length;
  const bradfordFactorScore = calculateBradfordFactor(validEvaluationRecords);

  // 7. Deductions
  const {
    absentDeduction,
    leaveDeduction,
    notEmployedDeduction,
    totalUndertimeHours,
    adjustedAllowances,
    componentDeductions,
    deductionBreakdownByOccasion,
    unadjustedOccasionDeductions,
  } = calculateAbsentDeductions(employee, workingDayRecords, calendarDaysInMonth, attendanceAdjustments);

  const allowanceNames: Record<string, string> = {
    basicSalary: "Basic Salary",
  };
  const fixedComponents: Record<string, boolean> = {
    basicSalary: false,
  };
  for (const a of config) {
    allowanceNames[a.id] = a.name;
    const hasAnyDeduction = Object.values(a.deductions || {}).some(Boolean);
    fixedComponents[a.id] = !hasAnyDeduction;
  }

  // ── 5. Overtime ───────────────────────────────────────────────────────────
  const overtimeMultiplier = additionalAmounts.overtimeMultiplier || 1.0;
  const overtimeAmount =
    additionalAmounts.overtimeAmount ??
    calculateOvertimePay(
      basicSalaryStd,
      stdDutyHours,
      calendarDaysInMonth,
      totalOvertimeHours,
      overtimeMultiplier,
    );

  // ── 6. Night shift ────────────────────────────────────────────────────────
  let nightShiftAllowanceAmount = additionalAmounts.nightShiftAllowance || 0;
  if (nightShiftAllowanceAmount === 0 && nightShiftsCount > 0) {
    const nightShiftRate = getAllowanceAmount(config, "nightShift");
    nightShiftAllowanceAmount = nightShiftRate * nightShiftsCount;
  }

  const incentiveAmount = additionalAmounts.incentiveAmount || 0;
  const commissionAmount = additionalAmounts.commissionAmount || 0;
  const bonusAmount = additionalAmounts.bonusAmount || 0;

  // ── 7. Gross ──────────────────────────────────────────────────────────────
  const originalAllowanceBreakdown: Record<string, number> = {
    basicSalary: Math.round(basicSalaryStd),
  };
  for (const allowance of config) {
    originalAllowanceBreakdown[allowance.id] = Math.round(allowance.amount);
  }

  let standardGrossSalary = basicSalaryStd;
  for (const allowance of config) {
    if (allowance.id !== "nightShift") standardGrossSalary += allowance.amount;
  }
  const grossSalary =
    standardGrossSalary +
    overtimeAmount +
    nightShiftAllowanceAmount +
    incentiveAmount +
    commissionAmount +
    bonusAmount;

  // ── 8. Flat deductions ────────────────────────────────────────────────────
  const manualDeductionsTotal = deductionConfig.manualDeductions.reduce(
    (s, d) => s + d.amount,
    0,
  );
  const advanceDeduction = additionalAmounts.advanceDeduction || 0;
  const taxDeduction = additionalAmounts.taxDeduction || 0;
  const otherDeduction = manualDeductionsTotal;

  const attendanceAndProrationDeductions =
    absentDeduction + leaveDeduction + notEmployedDeduction;
  const totalDeductions =
    attendanceAndProrationDeductions +
    advanceDeduction +
    taxDeduction +
    otherDeduction;
  const netSalary = grossSalary - totalDeductions; // Allow negative for carry-forward

  // ── 9. Standard breakdown snapshot ───────────────────────────────────────
  const standardBreakdown: Record<string, number> = {};
  standardBreakdown["basicSalary"] = basicSalaryStd;
  for (const a of config) standardBreakdown[a.id] = a.amount;

  const perDayBasic = basicSalaryStd / calendarDaysInMonth;
  const perHourBasic = perDayBasic / stdDutyHours;

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    designation: employee.designation,
    cnic: employee.cnic || "N/A",
    bankName: employee.bankName || "N/A",
    bankAccountNumber: employee.bankAccountNumber || "N/A",

    payrollMonth: format(parseISO(payrollPeriod.month), "MMM-yy"),
    startDate: payrollPeriod.startDate,
    endDate: payrollPeriod.endDate,

    totalWorkingDays: fullCycleWorkingDays,
    daysPresent,
    daysAbsent,
    daysLeave,
    daysUnapprovedLeave,
    daysSickLeave,
    daysCasualLeave,
    daysAnnualLeave,
    daysSpecialLeave,
    daysNotEmployed,
    unmarkedDays,
    totalOvertimeHours: +totalOvertimeHours.toFixed(2),
    totalUndertimeHours,
    nightShiftsCount,
    bradfordFactorScore,
    bradfordFactorPeriod: `${format(parseISO(evaluationStartDate), "d MMM yyyy")} to ${format(parseISO(evaluationEndDate), "d MMM yyyy")}`,

    basicSalary: Math.round(basicSalaryStd),
    allowanceBreakdown: originalAllowanceBreakdown,

    overtimeAmount,
    nightShiftAllowanceAmount,
    incentiveAmount,
    commissionAmount,
    bonusAmount,

    notEmployedDeduction: Math.round(notEmployedDeduction),
    absentDeduction: Math.round(absentDeduction),
    leaveDeduction: Math.round(leaveDeduction),
    advanceDeduction: Math.round(advanceDeduction),
    taxDeduction: Math.round(taxDeduction),
    manualDeductions: deductionConfig.manualDeductions,
    otherDeduction: Math.round(otherDeduction),

    grossSalary: Math.round(grossSalary),
    totalDeductions: Math.round(totalDeductions),
    netSalary: Math.round(netSalary),
    paymentSource: null,

    standardBreakdown,
    adjustedBreakdown: adjustedAllowances,
    componentDeductions,
    deductionBreakdownByOccasion,
    unadjustedOccasionDeductions,
    allowanceNames,
    fixedComponents,
    attendanceAdjustments,
    calculationMeta: {
      calendarDaysInMonth,
      perDayBasic: +perDayBasic.toFixed(4),
      perHourBasic: +perHourBasic.toFixed(4),
      overtimeMultiplier,
      overtimeRatePerHour: +(perHourBasic * overtimeMultiplier).toFixed(4),
      standardDutyHours: stdDutyHours,
      restDays,
    },

    remarks: "",
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

export function validatePayslip(payslip: PayslipCalculation): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (payslip.netSalary < 0) {
    errors.push("Net salary is negative. Deductions exceed earnings.");
  }
  if (payslip.grossSalary === 0) {
    warnings.push("Gross salary is zero. Employee may be on unpaid leave.");
  }

  const totalDays =
    payslip.daysPresent +
    payslip.daysAbsent +
    payslip.daysLeave +
    payslip.daysUnapprovedLeave;

  if (totalDays > payslip.totalWorkingDays) {
    errors.push("Total attendance days exceed working days in period.");
  }

  return { isValid: errors.length === 0, warnings, errors };
}
