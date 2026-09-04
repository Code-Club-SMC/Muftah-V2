import { db } from "@/db";
import {
  employees,
  payslips,
  payrolls,
  salaryAdvances,
  advanceInstallments,
  nightShiftRates,
  travelLogs,
  bradfordAuditLog,
  hrPayrollSettings,
  HR_PAYROLL_SETTINGS_SINGLETON_ID,
} from "@/db/schemas/hr-schema";
import { orderBookerTrips, commissionRecords, orderBookers } from "@/db/schemas/sales-erp-schema";
import { eq, and, inArray, gte, lt, desc, sql, isNull } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import {
  buildRestDayDateSet,
  calculatePayslip,
  calculateYearlyBradfordFactor,
  type DeductionConfig,
  type AttendanceRecord,
  type EmployeeData,
} from "@/lib/payroll-calculator";
import { getSalaryAtDate } from "./salary-revisions-fn";
import { addDays, parseISO } from "date-fns";
import {
  DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
  type BasicSalaryDeductionPolicy,
} from "@/lib/types/hr-types";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AdvanceProcessRecord = {
  id: string;
  installmentAmount: number;
  installmentNo: number;
  totalInstallments: number;
  remainingBalance: number;
  isFullySettled: boolean;
};

async function getCompanyBasicSalaryDeductionPolicy(): Promise<BasicSalaryDeductionPolicy> {
  const settings = await db.query.hrPayrollSettings.findFirst({
    where: eq(hrPayrollSettings.id, HR_PAYROLL_SETTINGS_SINGLETON_ID),
  });

  return {
    ...DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
    ...(settings?.basicSalaryDeductionPolicy ?? {}),
  };
}

function resolveBasicSalaryDeductionPolicy(
  employee: typeof employees.$inferSelect,
  companyPolicy: BasicSalaryDeductionPolicy,
): BasicSalaryDeductionPolicy {
  if (
    employee.basicSalaryDeductionPolicyOverrideEnabled &&
    employee.basicSalaryDeductionPolicyOverride
  ) {
    return {
      ...companyPolicy,
      ...employee.basicSalaryDeductionPolicyOverride,
    };
  }

  return companyPolicy;
}

function shouldBlockMissingAttendance(
  employee: Pick<typeof employees.$inferSelect, "isSalesman" | "isOrderBooker">,
): boolean {
  // Order bookers are trip-driven now, so missing working days mean Pending / Review.
  // Salesmen still do not have an approved attendance source in this scope.
  if (employee.isOrderBooker) return true;
  return !employee.isSalesman;
}

/**
 * Shared logic to fetch and calculate advance deductions for an employee.
 * Hardened to handle legacy null installmentAmounts by calculating on-the-fly.
 */
export async function calculateEnrichedAdvanceDeductions(
  employeeId: string,
  executor: typeof db | DbTransaction = db,
) {
  const pendingAdvances = await executor.query.salaryAdvances.findMany({
    where: and(
      eq(salaryAdvances.employeeId, employeeId),
      eq(salaryAdvances.status, "approved"),
    ),
  });

  // Only advances that still have installments remaining
  const activeAdvances = pendingAdvances.filter(
    (a) => a.installmentsPaid < a.installmentMonths,
  );

  let totalDeduction = 0;
  const processedRecords: AdvanceProcessRecord[] = [];

  for (const adv of activeAdvances) {
    const totalAmount = parseFloat(adv.amount);
    const months = adv.installmentMonths || 1;
    const paidCount = adv.installmentsPaid || 0;

    const currentInstallmentNo = paidCount + 1;
    const alreadyRecovered = processedRecords
      .filter((record) => record.id === adv.id)
      .reduce((sum, record) => sum + record.installmentAmount, 0);
    const scheduledPriorRecovery = adv.installmentAmount
      ? parseFloat(adv.installmentAmount) * paidCount
      : +(totalAmount / months).toFixed(2) * paidCount;
    const remainingBeforeThis = Math.max(
      0,
      totalAmount - scheduledPriorRecovery - alreadyRecovered,
    );
    const baseInstallment = adv.installmentAmount
      ? parseFloat(adv.installmentAmount)
      : +(totalAmount / months).toFixed(2);
    const instAmt =
      currentInstallmentNo >= months
        ? +remainingBeforeThis.toFixed(2)
        : Math.min(baseInstallment, remainingBeforeThis);
    const remainingAfterThis = Math.max(0, remainingBeforeThis - instAmt);

    totalDeduction += instAmt;
    processedRecords.push({
      id: adv.id,
      installmentAmount: instAmt,
      installmentNo: currentInstallmentNo,
      totalInstallments: months,
      remainingBalance: remainingAfterThis,
      isFullySettled: currentInstallmentNo >= months,
    });
  }

  return { totalDeduction, processedRecords };
}

async function recalculateAdvanceDeductionsAfterPayslipReversal(
  tx: DbTransaction,
  employeeId: string,
  previousAdvanceDeduction: number,
  payslipCalc: ReturnType<typeof calculatePayslip>,
) {
  const { totalDeduction, processedRecords } =
    await calculateEnrichedAdvanceDeductions(employeeId, tx);
  const advanceDeductionDelta = totalDeduction - previousAdvanceDeduction;

  payslipCalc.advanceDeduction = totalDeduction;
  payslipCalc.totalDeductions += advanceDeductionDelta;
  payslipCalc.netSalary -= advanceDeductionDelta;

  return {
    advanceDeduction: totalDeduction,
    advanceDeductionDelta,
    advanceIdsToProcess: processedRecords,
  };
}

export async function syncPayrollTotal(
  executor: Pick<DbTransaction, "select" | "update"> | typeof db,
  payrollId: string,
) {
  const [row] = await executor
    .select({
      total: sql<string>`COALESCE(sum(CAST(${payslips.netSalary} AS numeric)), 0)::text`,
    })
    .from(payslips)
    .where(eq(payslips.payrollId, payrollId));

  await executor
    .update(payrolls)
    .set({ totalAmount: row?.total || "0" })
    .where(eq(payrolls.id, payrollId));

  return row?.total || "0";
}

export async function reversePayslipSideEffects(
  tx: DbTransaction,
  payslipId: string,
) {
  const installments = await tx.query.advanceInstallments.findMany({
    where: eq(advanceInstallments.payslipId, payslipId),
    columns: {
      id: true,
      advanceId: true,
    },
  });

  if (installments.length > 0) {
    const perAdvanceCounts = installments.reduce(
      (acc, installment) => {
        acc.set(
          installment.advanceId,
          (acc.get(installment.advanceId) ?? 0) + 1,
        );
        return acc;
      },
      new Map<string, number>(),
    );

    for (const [advanceId, count] of perAdvanceCounts.entries()) {
      const advance = await tx.query.salaryAdvances.findFirst({
        where: eq(salaryAdvances.id, advanceId),
        columns: {
          installmentsPaid: true,
        },
      });

      if (!advance) continue;

      const revertedInstallmentsPaid = Math.max(
        0,
        (advance.installmentsPaid ?? 0) - count,
      );

      await tx
        .update(salaryAdvances)
        .set({
          status: "approved",
          installmentsPaid: revertedInstallmentsPaid,
        })
        .where(eq(salaryAdvances.id, advanceId));
    }

    await tx
      .delete(advanceInstallments)
      .where(eq(advanceInstallments.payslipId, payslipId));
  }

  await tx
    .update(commissionRecords)
    .set({
      status: "accrued",
      paidInPayslipId: null,
      updatedAt: new Date(),
    })
    .where(eq(commissionRecords.paidInPayslipId, payslipId));

  await tx
    .update(travelLogs)
    .set({
      status: "approved",
      reimbursedAt: null,
      reimbursedBy: null,
      reimbursedVia: null,
      reimbursedAmount: null,
      paidInPayslipId: null,
      updatedAt: new Date(),
    })
    .where(eq(travelLogs.paidInPayslipId, payslipId));

  await tx
    .delete(bradfordAuditLog)
    .where(eq(bradfordAuditLog.payslipId, payslipId));
}

async function getPreviousDeficitForPeriod(
  employeeId: string,
  currentPayrollMonth: string,
) {
  const [row] = await db
    .select({
      carriedForwardDeficit: payslips.carriedForwardDeficit,
    })
    .from(payslips)
    .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
    .where(
      and(
        eq(payslips.employeeId, employeeId),
        lt(payrolls.month, currentPayrollMonth),
      ),
    )
    .orderBy(desc(payrolls.month))
    .limit(1);

  return row ? parseFloat(row.carriedForwardDeficit || "0") : 0;
}

export type GeneratePayslipInput = {
  employeeId: string;
  payrollId: string;
  payrollPeriod: {
    month: string;
    startDate: string;
    endDate: string;
  };
  deductionConfig?: DeductionConfig;
  additionalAmounts?: {
    overtimeAmount?: number;
    nightShiftAllowance?: number;
    incentiveAmount?: number;
    bonusAmount?: number;
    advanceDeduction?: number;
    taxDeduction?: number;
    overtimeMultiplier?: number;
  };
  /**
   * Arrears Roll-Forward -- missed prior-cycle salaries to include in this slip.
   *
   * Each entry in arrearsFromMonths is a YYYY-MM payout-month key that was missed.
   * arrearsAmount is the total PKR to add on top of this cycle's net salary.
   * The months are stored in the payslip so future detection queries skip them.
   *
   * Runtime validation rules:
   *  - All months must be valid YYYY-MM strings strictly in the past
   *  - Max 12 months per payslip (prevents accidental mass-rollup)
   *  - arrearsAmount must be > 0 when arrearsFromMonths is non-empty
   */
  arrears?: {
    arrearsAmount: number;
    arrearsFromMonths: string[];
  };
  autoDeductAdvances?: boolean;
  autoUpdateLeaveBalances?: boolean;
  autoFetchNightShiftRate?: boolean;
  autoFetchTada?: boolean;
  earlyCutoffDate?: string;
  ignorePastUnmarkedDays?: boolean;
  /** User-entered payslip remarks. If omitted, stored as empty string. */
  remarks?: string;
};

export async function generateEmployeePayslipCore(
  input: GeneratePayslipInput,
  performedById: string,
) {
  const {
    employeeId,
    payrollId,
    payrollPeriod,
    deductionConfig,
    additionalAmounts = {},
    arrears,
    autoDeductAdvances = true,
    autoUpdateLeaveBalances: _autoUpdateLeaveBalances = true,
    autoFetchNightShiftRate = true,
    autoFetchTada = true,
    earlyCutoffDate,
    ignorePastUnmarkedDays = false,
    remarks = "",
  } = input;

  // -- 0. Validate arrears (fail-fast before any DB work) --------------------
  const arrearsAmt = arrears?.arrearsAmount ?? 0;
  const arrearsMonths = arrears?.arrearsFromMonths ?? [];

  if (arrearsMonths.length > 0) {
    if (arrearsAmt <= 0) {
      throw new Error("arrearsAmount must be > 0 when arrearsFromMonths is provided.");
    }
    if (arrearsMonths.length > 12) {
      throw new Error("Cannot roll forward more than 12 missed months in a single payslip.");
    }
    const todayKey = payrollPeriod.month.substring(0, 7); // YYYY-MM of current cycle
    const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
    for (const m of arrearsMonths) {
      if (!monthRe.test(m)) {
        throw new Error(`Invalid arrears month key: "${m}". Must be YYYY-MM format.`);
      }
      if (m >= todayKey) {
        throw new Error(
          `Arrears month "${m}" is not in the past. Only closed cycles can be rolled forward.`,
        );
      }
    }
  }

  // -- 1. Employee + Historical Salary -------------------------------------
  const employeeData = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });
  if (!employeeData) throw new Error(`Employee ${employeeId} not found`);
  const employeeRestDays = (employeeData.restDays as number[] | null) ?? [0];
  const companyBasicPolicy = await getCompanyBasicSalaryDeductionPolicy();
  const basicSalaryDeductionPolicy = resolveBasicSalaryDeductionPolicy(
    employeeData,
    companyBasicPolicy,
  );

  // Fetch the salary revision active for this payroll period
  const salaryRevision = await getSalaryAtDate(employeeId, payrollPeriod.startDate);
  if (!salaryRevision) {
    throw new Error(`No salary configuration found for employee ${employeeId} at ${payrollPeriod.startDate}`);
  }

  // Merge historical salary onto employee data for the calculator
  const employeeWithHistoricalSalary = {
    ...employeeData,
    basicSalary: salaryRevision.basicSalary,
    allowanceConfig: salaryRevision.allowanceConfig,
    basicSalaryDeductionPolicy,
  };

  // -- 2. Attendance ---------------------------------------------------------
  const rawAttendance = await db.query.attendance.findMany({
    where: (table, { and, gte, lte, eq }) =>
      and(
        eq(table.employeeId, employeeId),
        gte(table.date, payrollPeriod.startDate),
        lte(table.date, payrollPeriod.endDate),
      ),
  });

  const formattedAttendance: AttendanceRecord[] = rawAttendance.map((r) => ({
    date: r.date,
    status: r.status,
    dutyHours: r.dutyHours,
    overtimeHours: r.overtimeHours,
    isNightShift: r.isNightShift || false,
    isApprovedLeave: r.isApprovedLeave ?? false,
    leaveType: r.leaveType ?? null,
    overtimeStatus: r.overtimeStatus ?? "pending",
    overtimeCompensationMethod: r.overtimeCompensationMethod as "payout" | "comp_off" | undefined,
    compensatoryHoursUsed: r.compensatoryHoursUsed,
    isLate: r.isLate ?? false,
    earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
  }));

  // -- 3. Salary advances (installment-aware) --------------------------------
  let advanceDeduction: number;
  let advanceIdsToProcess: AdvanceProcessRecord[] = [];

  if (autoDeductAdvances && additionalAmounts.advanceDeduction === undefined) {
    const { totalDeduction, processedRecords } = await calculateEnrichedAdvanceDeductions(employeeId);
    advanceDeduction = totalDeduction;
    advanceIdsToProcess = processedRecords;
  } else {
    advanceDeduction = additionalAmounts.advanceDeduction ?? 0;
  }

  // -- 4. Night shift rate ---------------------------------------------------
  let nightShiftAllowance = additionalAmounts.nightShiftAllowance;
  if (autoFetchNightShiftRate && nightShiftAllowance === undefined) {
    const nightShifts = formattedAttendance.filter(
      (r) => r.status === "present" && r.isNightShift,
    );
    if (nightShifts.length > 0) {
      const payrollYear = new Date(payrollPeriod.month).getFullYear();
      const rateConfig = await db.query.nightShiftRates.findFirst({
        where: eq(nightShiftRates.year, payrollYear),
      });
      nightShiftAllowance = (rateConfig ? parseFloat(rateConfig.ratePerNight) : 0) * nightShifts.length;
    } else {
      nightShiftAllowance = 0;
    }
  }

  // -- 5. TA/DA from travel logs ---------------------------------------------
  let tadaAmount = 0;
  let approvedTravelLogIds: string[] = [];
  if (autoFetchTada) {
    const approvedTrips = await db.query.travelLogs.findMany({
      where: and(
        eq(travelLogs.employeeId, employeeId),
        eq(travelLogs.status, "approved"),
        isNull(travelLogs.reimbursedAt), // Skip already-reimbursed logs
        and(
          sql`${travelLogs.date} >= ${payrollPeriod.startDate}`,
          sql`${travelLogs.date} <= ${payrollPeriod.endDate}`,
        ),
      ),
    });
    approvedTravelLogIds = approvedTrips.map((trip) => trip.id);
    tadaAmount = approvedTrips.reduce(
      (sum, t) => sum + parseFloat(t.totalAmount || "0"),
      0,
    );
  }

  // -- 5.5 Order booker TA + commission --------------------------------------
  let dynamicTA = 0;
  let orderBookerCommission = 0;
  let commissionIdsToPay: string[] = [];
  let commissionBreakdownSnapshot: Array<{
    orderId: string;
    orderRef: string;
    orderDate: string;
    orderValue: number;
    rate: number;
    amount: number;
  }> = [];

  // Find linked order booker for this employee
  const linkedOrderBooker = await db.query.orderBookers.findFirst({
    where: eq(orderBookers.employeeId, employeeId),
  });

  if (linkedOrderBooker) {
    const payrollStartTs = parseISO(payrollPeriod.startDate);
    const payrollEndExclusiveTs = addDays(parseISO(payrollPeriod.endDate), 1);

    // Sum trip TADA + fuel costs within payroll period
    const trips = await db.query.orderBookerTrips.findMany({
      where: and(
        eq(orderBookerTrips.orderBookerId, linkedOrderBooker.id),
        gte(orderBookerTrips.tripDate, payrollStartTs),
        lt(orderBookerTrips.tripDate, payrollEndExclusiveTs),
      ),
    });
    dynamicTA = trips.reduce((sum, trip) => {
      const tada = parseFloat(trip.tadaAmount || "0");
      const fuel = parseFloat(trip.fuelCost || "0");
      return sum + tada + fuel;
    }, 0);

    // Sum accrued commission records within payroll period
    const commissions = await db.query.commissionRecords.findMany({
      where: and(
        eq(commissionRecords.orderBookerId, linkedOrderBooker.id),
        eq(commissionRecords.status, "accrued"),
        gte(commissionRecords.calculatedAt, payrollStartTs),
        lt(commissionRecords.calculatedAt, payrollEndExclusiveTs),
      ),
      with: {
        order: {
          columns: { id: true, billNumber: true, createdAt: true, fulfilledAmount: true },
        },
      },
    });
    orderBookerCommission = commissions.reduce(
      (sum, rec) => sum + parseFloat(rec.commissionAmount || "0"),
      0,
    );
    commissionIdsToPay = commissions.map((c) => c.id);

    // Build commission breakdown snapshot for payslip
    commissionBreakdownSnapshot = commissions.map((rec) => ({
      orderId: rec.orderId,
      orderRef: `ORD-${rec.order?.billNumber || rec.orderId.substring(0, 8)}`,
      orderDate: rec.order?.createdAt ? new Date(rec.order.createdAt).toISOString().split("T")[0] : "",
      orderValue: parseFloat(rec.order?.fulfilledAmount || rec.fulfilledAmount || "0"),
      rate: parseFloat(rec.appliedRate || "0"),
      amount: parseFloat(rec.commissionAmount || "0"),
    }));
  }

  // -- 6. Calculate payslip --------------------------------------------------
  const mergedAdditional = {
    ...additionalAmounts,
    advanceDeduction,
    nightShiftAllowance: nightShiftAllowance ?? additionalAmounts.nightShiftAllowance,
    incentiveAmount:
      (additionalAmounts.incentiveAmount || 0) + tadaAmount + dynamicTA,
    commissionAmount: orderBookerCommission,
  };

  const payslipCalc = calculatePayslip(
    employeeWithHistoricalSalary as unknown as EmployeeData,
    formattedAttendance,
    payrollPeriod,
    deductionConfig,
    mergedAdditional,
    earlyCutoffDate,
  );

  // -- 6.1 Strict validation for missing attendance --------------------------
  if (
    payslipCalc.unmarkedDays > 0 &&
    !ignorePastUnmarkedDays &&
    shouldBlockMissingAttendance(employeeData)
  ) {
    const err = new Error(`PAST_UNMARKED_DAYS:${payslipCalc.unmarkedDays}`);
    err.name = "ValidationError";
    throw err;
  }

  // -- 6.5 Yearly Bradford Factor (Jan 1 - Dec 31 of the payroll year) -------
  const payrollYear = new Date(payrollPeriod.month).getFullYear();
  const yearStart = `${payrollYear}-01-01`;
  const yearEnd = `${payrollYear}-12-31`;
  const yearAttendanceRaw = await db.query.attendance.findMany({
    where: (table, { and, eq, gte, lte }) =>
      and(
        eq(table.employeeId, employeeId),
        gte(table.date, yearStart),
        lte(table.date, yearEnd),
      ),
  });
  const yearAttendanceFormatted: AttendanceRecord[] = yearAttendanceRaw.map((r) => ({
    date: r.date,
    status: r.status as any,
    dutyHours: r.dutyHours,
    overtimeHours: r.overtimeHours,
    isNightShift: r.isNightShift || false,
    isApprovedLeave: r.isApprovedLeave ?? false,
    leaveType: r.leaveType ?? null,
    overtimeStatus: r.overtimeStatus ?? "pending",
    overtimeCompensationMethod: r.overtimeCompensationMethod as "payout" | "comp_off" | undefined,
    compensatoryHoursUsed: r.compensatoryHoursUsed,
    isLate: r.isLate ?? false,
    earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
  }));
  const yearlyRestDaySet = buildRestDayDateSet(
    yearStart,
    yearEnd,
    employeeRestDays,
  );
  const yearlyBradfordScore = calculateYearlyBradfordFactor(
    yearAttendanceFormatted.filter(
      (record) => !yearlyRestDaySet.has(record.date) && record.status !== "holiday",
    ),
  );

  // -- 6.6 Fetch carried-forward deficit from previous payslip ----------------
  const previousDeficit = await getPreviousDeficitForPeriod(
    employeeId,
    payrollPeriod.month,
  );

  // Add previous deficit to deductions
  if (previousDeficit > 0) {
    payslipCalc.totalDeductions += previousDeficit;
    payslipCalc.netSalary -= previousDeficit;
  }

  // -- 7. Carry-forward math --------------------------------------------------
  let totalNetWithArrears = payslipCalc.netSalary + arrearsAmt;
  let carriedForwardDeficit = payslipCalc.netSalary < 0 ? Math.abs(payslipCalc.netSalary) : 0;

  // -- 8. Atomic transaction: reverse old side effects -> save payslip --------
  const savedPayslip = await db.transaction(async (tx) => {
    const existingPayslip = await tx.query.payslips.findFirst({
      where: and(
        eq(payslips.payrollId, payrollId),
        eq(payslips.employeeId, employeeId),
      ),
      columns: {
        id: true,
      },
    });

    if (existingPayslip) {
      await reversePayslipSideEffects(tx, existingPayslip.id);

      if (autoDeductAdvances && additionalAmounts.advanceDeduction === undefined) {
        const recalculatedAdvances =
          await recalculateAdvanceDeductionsAfterPayslipReversal(
            tx,
            employeeId,
            advanceDeduction,
            payslipCalc,
          );
        advanceDeduction = recalculatedAdvances.advanceDeduction;
        advanceIdsToProcess = recalculatedAdvances.advanceIdsToProcess;
        totalNetWithArrears = payslipCalc.netSalary + arrearsAmt;
        carriedForwardDeficit =
          payslipCalc.netSalary < 0 ? Math.abs(payslipCalc.netSalary) : 0;
      }
    }

    // 8a. Delete existing payslip for this payroll+employee (idempotent regeneration)
    await tx
      .delete(payslips)
      .where(
        and(
          eq(payslips.payrollId, payrollId),
          eq(payslips.employeeId, employeeId),
        ),
      );

    // 8b. Insert new payslip
    const [slip] = await tx
      .insert(payslips)
      .values({
        payrollId,
        employeeId: employeeData.id,
        salaryRevisionId: salaryRevision.id === "current" ? null : salaryRevision.id,

        daysPresent: payslipCalc.daysPresent,
        daysAbsent: payslipCalc.daysAbsent,
        daysLeave: payslipCalc.daysLeave,
        totalOvertimeHours: payslipCalc.totalOvertimeHours.toString(),
        nightShiftsCount: payslipCalc.nightShiftsCount,

        bradfordFactorScore: payslipCalc.bradfordFactorScore.toString(),
        bradfordFactorPeriod: payslipCalc.bradfordFactorPeriod,
        yearlyBradfordScore: yearlyBradfordScore.toString(),

        basicSalary: payslipCalc.basicSalary.toString(),
        allowanceBreakdown: payslipCalc.allowanceBreakdown,
        overtimeAmount: payslipCalc.overtimeAmount.toString(),
        nightShiftAllowanceAmount: payslipCalc.nightShiftAllowanceAmount.toString(),
        incentiveAmount: payslipCalc.incentiveAmount.toString(),
        commissionAmount: payslipCalc.commissionAmount.toString(),
        commissionBreakdown: commissionBreakdownSnapshot.length > 0 ? commissionBreakdownSnapshot : null,
        bonusAmount: payslipCalc.bonusAmount.toString(),

        absentDeduction: payslipCalc.absentDeduction.toString(),
        leaveDeduction: payslipCalc.leaveDeduction.toString(),
        notEmployedDeduction: payslipCalc.notEmployedDeduction.toString(),
        advanceDeduction: payslipCalc.advanceDeduction.toString(),
        taxDeduction: payslipCalc.taxDeduction.toString(),
        otherDeduction: payslipCalc.otherDeduction.toString(),

        grossSalary: payslipCalc.grossSalary.toString(),
        totalDeductions: payslipCalc.totalDeductions.toString(),
        // Net = calculator net + rolled-forward arrears from missed cycles
        netSalary: totalNetWithArrears.toString(),

        // Carry-forward deficit (when deductions exceed earnings)
        carriedForwardDeficit: carriedForwardDeficit.toString(),

        // Arrears audit trail -- stored permanently so future missed-cycle
        // detection queries skip these months for this employee.
        arrearsAmount: arrearsAmt.toString(),
        arrearsFromMonths: arrearsMonths.length > 0 ? arrearsMonths : [],

        paymentSource: null,
        remarks: remarks || null,
      })
      .returning();

    // 8c. Record advance installments and track progress
    if (advanceIdsToProcess.length > 0) {
      for (const adv of advanceIdsToProcess) {
        const previousInstallmentNo = Math.max(0, adv.installmentNo - 1);
        if (adv.isFullySettled) {
          const [updatedAdvance] = await tx
            .update(salaryAdvances)
            .set({ status: "settled", installmentsPaid: adv.installmentNo })
            .where(
              and(
                eq(salaryAdvances.id, adv.id),
                eq(salaryAdvances.status, "approved"),
                eq(salaryAdvances.installmentsPaid, previousInstallmentNo),
              ),
            )
            .returning({ id: salaryAdvances.id });
          if (!updatedAdvance) {
            throw new Error(
              "Salary advance changed during payroll generation. Please recalculate the payslip.",
            );
          }
        } else {
          const [updatedAdvance] = await tx
            .update(salaryAdvances)
            .set({ installmentsPaid: adv.installmentNo })
            .where(
              and(
                eq(salaryAdvances.id, adv.id),
                eq(salaryAdvances.status, "approved"),
                eq(salaryAdvances.installmentsPaid, previousInstallmentNo),
              ),
            )
            .returning({ id: salaryAdvances.id });
          if (!updatedAdvance) {
            throw new Error(
              "Salary advance changed during payroll generation. Please recalculate the payslip.",
            );
          }
        }

        await tx.insert(advanceInstallments).values({
          id: createId(),
          advanceId: adv.id,
          payslipId: slip.id,
          amount: adv.installmentAmount.toString(),
          installmentNo: adv.installmentNo,
        });
      }
    }

    // 8d. Pay out accrued commission records for linked order booker
    if (linkedOrderBooker && commissionIdsToPay.length > 0) {
      const paidCommissionRecords = await tx
        .update(commissionRecords)
        .set({
          status: "paid",
          paidInPayslipId: slip.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(commissionRecords.id, commissionIdsToPay),
            eq(commissionRecords.status, "accrued"),
          ),
        )
        .returning({ id: commissionRecords.id });

      if (paidCommissionRecords.length !== commissionIdsToPay.length) {
        throw new Error(
          "Commission records changed during payroll generation. Please recalculate the payslip.",
        );
      }
    }

    if (approvedTravelLogIds.length > 0) {
      const reimbursedTravelLogs = await tx
        .update(travelLogs)
        .set({
          status: "reimbursed",
          reimbursedAt: new Date(),
          reimbursedBy: performedById,
          reimbursedVia: "payroll",
          reimbursedAmount: sql`${travelLogs.totalAmount}`,
          paidInPayslipId: slip.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(travelLogs.id, approvedTravelLogIds),
            eq(travelLogs.status, "approved"),
            isNull(travelLogs.reimbursedAt),
          ),
        )
        .returning({ id: travelLogs.id });

      if (reimbursedTravelLogs.length !== approvedTravelLogIds.length) {
        throw new Error(
          "TA/DA logs changed during payroll generation. Please recalculate the payslip.",
        );
      }
    }

    return slip;
  });

  return {
    ...savedPayslip,
    calculation: payslipCalc,
    arrearsAmount: arrearsAmt,
    arrearsFromMonths: arrearsMonths,
    totalNetWithArrears,
    walletDebited: null,
  };
}

/**
 * Simulate payslip generation WITHOUT writing to database.
 * Returns the same calculation output as generateEmployeePayslipCore
 * but performs no inserts, updates, or wallet debits.
 */
export async function simulateEmployeePayslipCore(
  input: GeneratePayslipInput,
) {
  const {
    employeeId,
    payrollPeriod,
    deductionConfig,
    additionalAmounts = {},
    arrears,
    autoDeductAdvances = true,
    autoFetchNightShiftRate = true,
    autoFetchTada = true,
    earlyCutoffDate,
    ignorePastUnmarkedDays = false,
  } = input;

  // -- 0. Validate arrears (fail-fast before any DB work) --------------------
  const arrearsAmt = arrears?.arrearsAmount ?? 0;
  const arrearsMonths = arrears?.arrearsFromMonths ?? [];

  if (arrearsMonths.length > 0) {
    if (arrearsAmt <= 0) {
      throw new Error("arrearsAmount must be > 0 when arrearsFromMonths is provided.");
    }
    if (arrearsMonths.length > 12) {
      throw new Error("Cannot roll forward more than 12 missed months in a single payslip.");
    }
    const todayKey = payrollPeriod.month.substring(0, 7);
    const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
    for (const m of arrearsMonths) {
      if (!monthRe.test(m)) {
        throw new Error(`Invalid arrears month key: "${m}". Must be YYYY-MM format.`);
      }
      if (m >= todayKey) {
        throw new Error(
          `Arrears month "${m}" is not in the past. Only closed cycles can be rolled forward.`,
        );
      }
    }
  }

  // -- 1. Employee + Historical Salary -------------------------------------
  const employeeData = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });
  if (!employeeData) throw new Error(`Employee ${employeeId} not found`);
  const employeeRestDays = (employeeData.restDays as number[] | null) ?? [0];
  const companyBasicPolicy = await getCompanyBasicSalaryDeductionPolicy();
  const basicSalaryDeductionPolicy = resolveBasicSalaryDeductionPolicy(
    employeeData,
    companyBasicPolicy,
  );

  const salaryRevision = await getSalaryAtDate(employeeId, payrollPeriod.startDate);
  if (!salaryRevision) {
    throw new Error(`No salary configuration found for employee ${employeeId} at ${payrollPeriod.startDate}`);
  }

  const employeeWithHistoricalSalary = {
    ...employeeData,
    basicSalary: salaryRevision.basicSalary,
    allowanceConfig: salaryRevision.allowanceConfig,
    basicSalaryDeductionPolicy,
  };

  // -- 2. Attendance ---------------------------------------------------------
  const rawAttendance = await db.query.attendance.findMany({
    where: (table, { and, gte, lte, eq }) =>
      and(
        eq(table.employeeId, employeeId),
        gte(table.date, payrollPeriod.startDate),
        lte(table.date, payrollPeriod.endDate),
      ),
  });

  const formattedAttendance: AttendanceRecord[] = rawAttendance.map((r) => ({
    date: r.date,
    status: r.status,
    dutyHours: r.dutyHours,
    overtimeHours: r.overtimeHours,
    isNightShift: r.isNightShift || false,
    isApprovedLeave: r.isApprovedLeave ?? false,
    leaveType: r.leaveType ?? null,
    overtimeStatus: r.overtimeStatus ?? "pending",
    overtimeCompensationMethod: r.overtimeCompensationMethod as "payout" | "comp_off" | undefined,
    compensatoryHoursUsed: r.compensatoryHoursUsed,
    isLate: r.isLate ?? false,
    earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
  }));

  // -- 3. Salary advances (installment-aware) --------------------------------
  let advanceDeduction: number;
  let advanceIdsToProcess: AdvanceProcessRecord[] = [];

  if (autoDeductAdvances && additionalAmounts.advanceDeduction === undefined) {
    const { totalDeduction, processedRecords } = await calculateEnrichedAdvanceDeductions(employeeId);
    advanceDeduction = totalDeduction;
    advanceIdsToProcess = processedRecords;
  } else {
    advanceDeduction = additionalAmounts.advanceDeduction ?? 0;
  }

  // -- 4. Night shift rate ---------------------------------------------------
  let nightShiftAllowance = additionalAmounts.nightShiftAllowance;
  if (autoFetchNightShiftRate && nightShiftAllowance === undefined) {
    const nightShifts = formattedAttendance.filter(
      (r) => r.status === "present" && r.isNightShift,
    );
    if (nightShifts.length > 0) {
      const payrollYear = new Date(payrollPeriod.month).getFullYear();
      const rateConfig = await db.query.nightShiftRates.findFirst({
        where: eq(nightShiftRates.year, payrollYear),
      });
      nightShiftAllowance = (rateConfig ? parseFloat(rateConfig.ratePerNight) : 0) * nightShifts.length;
    } else {
      nightShiftAllowance = 0;
    }
  }

  // -- 5. TA/DA from travel logs ---------------------------------------------
  let tadaAmount = 0;
  if (autoFetchTada) {
    const approvedTrips = await db.query.travelLogs.findMany({
      where: and(
        eq(travelLogs.employeeId, employeeId),
        eq(travelLogs.status, "approved"),
        isNull(travelLogs.reimbursedAt),
        and(
          sql`${travelLogs.date} >= ${payrollPeriod.startDate}`,
          sql`${travelLogs.date} <= ${payrollPeriod.endDate}`,
        ),
      ),
    });
    tadaAmount = approvedTrips.reduce(
      (sum, t) => sum + parseFloat(t.totalAmount || "0"),
      0,
    );
  }

  // -- 5.5 Order booker TA + commission --------------------------------------
  let dynamicTA = 0;
  let orderBookerCommission = 0;
  let commissionBreakdownSnapshot: Array<{
    orderId: string;
    orderRef: string;
    orderDate: string;
    orderValue: number;
    rate: number;
    amount: number;
  }> = [];

  const linkedOrderBooker = await db.query.orderBookers.findFirst({
    where: eq(orderBookers.employeeId, employeeId),
  });

  if (linkedOrderBooker) {
    const payrollStartTs = parseISO(payrollPeriod.startDate);
    const payrollEndExclusiveTs = addDays(parseISO(payrollPeriod.endDate), 1);

    const trips = await db.query.orderBookerTrips.findMany({
      where: and(
        eq(orderBookerTrips.orderBookerId, linkedOrderBooker.id),
        gte(orderBookerTrips.tripDate, payrollStartTs),
        lt(orderBookerTrips.tripDate, payrollEndExclusiveTs),
      ),
    });
    dynamicTA = trips.reduce((sum, trip) => {
      const tada = parseFloat(trip.tadaAmount || "0");
      const fuel = parseFloat(trip.fuelCost || "0");
      return sum + tada + fuel;
    }, 0);

    const commissions = await db.query.commissionRecords.findMany({
      where: and(
        eq(commissionRecords.orderBookerId, linkedOrderBooker.id),
        eq(commissionRecords.status, "accrued"),
        gte(commissionRecords.calculatedAt, payrollStartTs),
        lt(commissionRecords.calculatedAt, payrollEndExclusiveTs),
      ),
      with: {
        order: {
          columns: { id: true, billNumber: true, createdAt: true, fulfilledAmount: true },
        },
      },
    });
    orderBookerCommission = commissions.reduce(
      (sum, rec) => sum + parseFloat(rec.commissionAmount || "0"),
      0,
    );

    commissionBreakdownSnapshot = commissions.map((rec) => ({
      orderId: rec.orderId,
      orderRef: `ORD-${rec.order?.billNumber || rec.orderId.substring(0, 8)}`,
      orderDate: rec.order?.createdAt ? new Date(rec.order.createdAt).toISOString().split("T")[0] : "",
      orderValue: parseFloat(rec.order?.fulfilledAmount || rec.fulfilledAmount || "0"),
      rate: parseFloat(rec.appliedRate || "0"),
      amount: parseFloat(rec.commissionAmount || "0"),
    }));
  }

  // -- 6. Calculate payslip --------------------------------------------------
  const mergedAdditional = {
    ...additionalAmounts,
    advanceDeduction,
    nightShiftAllowance: nightShiftAllowance ?? additionalAmounts.nightShiftAllowance,
    incentiveAmount:
      (additionalAmounts.incentiveAmount || 0) + tadaAmount + dynamicTA,
    commissionAmount: orderBookerCommission,
  };

  const payslipCalc = calculatePayslip(
    employeeWithHistoricalSalary as unknown as EmployeeData,
    formattedAttendance,
    payrollPeriod,
    deductionConfig,
    mergedAdditional,
    earlyCutoffDate,
  );

  // -- 6.1 Strict validation for missing attendance --------------------------
  if (
    payslipCalc.unmarkedDays > 0 &&
    !ignorePastUnmarkedDays &&
    shouldBlockMissingAttendance(employeeData)
  ) {
    const err = new Error(`PAST_UNMARKED_DAYS:${payslipCalc.unmarkedDays}`);
    err.name = "ValidationError";
    throw err;
  }

  // -- 6.5 Yearly Bradford Factor --------------------------------------------
  const payrollYear = new Date(payrollPeriod.month).getFullYear();
  const yearStart = `${payrollYear}-01-01`;
  const yearEnd = `${payrollYear}-12-31`;
  const yearAttendanceRaw = await db.query.attendance.findMany({
    where: (table, { and, eq, gte, lte }) =>
      and(
        eq(table.employeeId, employeeId),
        gte(table.date, yearStart),
        lte(table.date, yearEnd),
      ),
  });
  const yearAttendanceFormatted: AttendanceRecord[] = yearAttendanceRaw.map((r) => ({
    date: r.date,
    status: r.status as any,
    dutyHours: r.dutyHours,
    overtimeHours: r.overtimeHours,
    isNightShift: r.isNightShift || false,
    isApprovedLeave: r.isApprovedLeave ?? false,
    leaveType: r.leaveType ?? null,
    overtimeStatus: r.overtimeStatus ?? "pending",
    overtimeCompensationMethod: r.overtimeCompensationMethod as "payout" | "comp_off" | undefined,
    compensatoryHoursUsed: r.compensatoryHoursUsed,
    isLate: r.isLate ?? false,
    earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
  }));
  const yearlyRestDaySet = buildRestDayDateSet(
    yearStart,
    yearEnd,
    employeeRestDays,
  );
  const yearlyBradfordScore = calculateYearlyBradfordFactor(
    yearAttendanceFormatted.filter(
      (record) => !yearlyRestDaySet.has(record.date) && record.status !== "holiday",
    ),
  );

  // -- 6.6 Fetch carried-forward deficit from previous payslip ----------------
  const previousDeficit = await getPreviousDeficitForPeriod(
    employeeId,
    payrollPeriod.month,
  );

  if (previousDeficit > 0) {
    payslipCalc.totalDeductions += previousDeficit;
    payslipCalc.netSalary -= previousDeficit;
  }

  const totalNetWithArrears = payslipCalc.netSalary + arrearsAmt;
  const carriedForwardDeficit = payslipCalc.netSalary < 0 ? Math.abs(payslipCalc.netSalary) : 0;

  // -- Return simulation result (NO DB WRITES) --------------------------------
  return {
    employee: {
      id: employeeData.id,
      employeeCode: employeeData.employeeCode,
      firstName: employeeData.firstName,
      lastName: employeeData.lastName,
      designation: employeeData.designation,
      cnic: employeeData.cnic,
      bankName: employeeData.bankName,
      bankAccountNumber: employeeData.bankAccountNumber,
    },
    calculation: payslipCalc,
    yearlyBradfordScore,
    arrearsAmount: arrearsAmt,
    arrearsFromMonths: arrearsMonths,
    totalNetWithArrears,
    carriedForwardDeficit,
    previousDeficit,
    commissionBreakdown: commissionBreakdownSnapshot,
    advanceProcessRecords: advanceIdsToProcess,
    salaryRevision: {
      id: salaryRevision.id,
      revisionDate: salaryRevision.revisionDate,
      basicSalary: salaryRevision.basicSalary,
    },
  };
}
