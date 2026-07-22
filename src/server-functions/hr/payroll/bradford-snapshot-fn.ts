/**
 * Bradford Factor Snapshot Server Functions
 * Freezes monthly attendance summaries when payroll is closed.
 */

import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  bradfordSnapshots,
  attendance,
  employees,
  payrolls,
  payslips,
} from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  buildRestDayDateSet,
  calculatePayslip,
  calculateYearlyBradfordFactor,
  type AttendanceRecord,
} from "@/lib/payroll-calculator";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | DbTransaction;

/**
 * Auto-snapshot Bradford data for all employees in a payroll.
 * Called when payroll status changes to "closed".
 */
export async function snapshotBradfordForPayroll(
  payrollId: string,
  executor: DbExecutor = db,
) {
  const payroll = await executor.query.payrolls.findFirst({
    where: eq(payrolls.id, payrollId),
  });
  if (!payroll) throw new Error(`Payroll ${payrollId} not found`);

  const yearMonth = payroll.month.substring(0, 7); // "YYYY-MM"

  // Find all payslips for this payroll
  const payrollPayslips = await executor.query.payslips.findMany({
    where: eq(payslips.payrollId, payrollId),
  });

  if (payrollPayslips.length === 0) {
    throw new Error(`No payslips found for payroll ${payrollId}`);
  }

  const snapshots = [];

  for (const payslip of payrollPayslips) {
    const employeeId = payslip.employeeId;
    const employee = await executor.query.employees.findFirst({
      where: eq(employees.id, employeeId),
    });
    if (!employee) {
      throw new Error(`Employee ${employeeId} not found for payslip ${payslip.id}`);
    }

    const restDays = (employee.restDays as number[] | null) ?? [0];

    // Get full-month attendance for this payroll period
    const periodAttendance = await executor.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        gte(attendance.date, payroll.startDate),
        lte(attendance.date, payroll.endDate),
      ),
    });

    const formattedPeriodAttendance: AttendanceRecord[] = periodAttendance.map((row) => ({
      date: row.date,
      status: row.status as any,
      dutyHours: row.dutyHours,
      overtimeHours: row.overtimeHours,
      isNightShift: row.isNightShift || false,
      isApprovedLeave: row.isApprovedLeave ?? false,
      leaveType: row.leaveType ?? null,
      overtimeStatus: row.overtimeStatus ?? "pending",
      isLate: row.isLate ?? false,
      earlyDepartureStatus: row.earlyDepartureStatus ?? "none",
    }));

    const periodRestDaySet = buildRestDayDateSet(
      payroll.startDate,
      payroll.endDate,
      restDays,
    );
    const workingPeriodAttendance = formattedPeriodAttendance.filter(
      (record) => !periodRestDaySet.has(record.date) && record.status !== "holiday",
    );

    const periodCalculation = calculatePayslip(
      employee as any,
      formattedPeriodAttendance,
      {
        month: payroll.month,
        startDate: payroll.startDate,
        endDate: payroll.endDate,
      },
      undefined,
      {},
      payroll.endDate,
    );

    // Counts
    const totalAbsences = workingPeriodAttendance.filter((row) => row.status === "absent").length;
    const totalSickLeaves = workingPeriodAttendance.filter(
      (row) => row.status === "leave" && row.leaveType === "sick" && row.isApprovedLeave,
    ).length;
    const totalAnnualLeaves = workingPeriodAttendance.filter(
      (row) => row.status === "leave" && row.leaveType === "annual" && row.isApprovedLeave,
    ).length;
    const totalLateArrivals = workingPeriodAttendance.filter((row) => row.isLate).length;
    const totalEarlyDepartures = workingPeriodAttendance.filter(
      (row) => (row.earlyDepartureStatus ?? "none") !== "none",
    ).length;
    const nightShiftsCount = workingPeriodAttendance.filter((row) => row.isNightShift).length;

    // Yearly Bradford (Jan 1 - Dec 31 of the payroll year)
    const payrollYear = new Date(payroll.month).getFullYear();
    const yearStart = `${payrollYear}-01-01`;
    const yearEnd = `${payrollYear}-12-31`;
    const yearAttendanceRaw = await executor.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        gte(attendance.date, yearStart),
        lte(attendance.date, yearEnd),
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
      isLate: r.isLate ?? false,
      earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
    }));
    const yearlyRestDaySet = buildRestDayDateSet(yearStart, yearEnd, restDays);
    const yearlyBradfordScore = calculateYearlyBradfordFactor(
      yearAttendanceFormatted.filter(
        (record) => !yearlyRestDaySet.has(record.date) && record.status !== "holiday",
      ),
    );

    const dailyAttendanceJson = periodAttendance.map((a) => ({
      date: a.date,
      status: a.status,
      isLate: a.isLate ?? false,
      earlyDepartureStatus: a.earlyDepartureStatus ?? "none",
      leaveType: a.leaveType ?? null,
    }));

    snapshots.push({
      employeeId,
      payrollId,
      payslipId: payslip.id,
      snapshotYearMonth: yearMonth,
      totalAbsences,
      totalSickLeaves,
      totalAnnualLeaves,
      totalLateArrivals,
      totalEarlyDepartures,
      nightShiftsCount,
      bradfordFactor: (
        payslip.bradfordFactorOverride ??
        payslip.bradfordFactorScore ??
        yearlyBradfordScore.toString()
      ).toString(),
      dailyAttendanceJson,
      unmarkedDaysAtClose: periodCalculation.unmarkedDays,
      remarks:
        `Snapshot on payroll approval. ` +
        `Payslip Bradford: ${payslip.bradfordFactorOverride ?? payslip.bradfordFactorScore ?? "N/A"}. ` +
        `Yearly Bradford: ${yearlyBradfordScore}.`,
    });
  }

  // Delete any existing snapshots for this payroll (idempotent)
  await executor
    .delete(bradfordSnapshots)
    .where(eq(bradfordSnapshots.payrollId, payrollId));

  // Insert all snapshots
  if (snapshots.length > 0) {
    await executor.insert(bradfordSnapshots).values(snapshots);
  }

  return { snapshotted: snapshots.length, payrollId };
}

/**
 * Server function: Trigger Bradford snapshot for a payroll
 */
export const snapshotBradfordForPayrollFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((input: any) =>
    ({ payrollId: input.payrollId } as { payrollId: string }),
  )
  .handler(async ({ data }) => {
    return snapshotBradfordForPayroll(data.payrollId);
  });

/**
 * Get Bradford snapshot history for an employee
 */
export const getBradfordSnapshotHistoryFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((input: any) =>
    ({ employeeId: input.employeeId } as { employeeId: string }),
  )
  .handler(async ({ data }) => {
    return db.query.bradfordSnapshots.findMany({
      where: eq(bradfordSnapshots.employeeId, data.employeeId),
      orderBy: [bradfordSnapshots.snapshotYearMonth],
      with: {
        payroll: { columns: { month: true, status: true } },
      },
    });
  });

/**
 * Get a single Bradford snapshot by ID
 */
export const getBradfordSnapshotByIdFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((input: any) =>
    ({ id: input.id } as { id: string }),
  )
  .handler(async ({ data }) => {
    const snapshot = await db.query.bradfordSnapshots.findFirst({
      where: eq(bradfordSnapshots.id, data.id),
      with: {
        employee: { columns: { id: true, firstName: true, lastName: true } },
        payroll: { columns: { month: true, status: true } },
        payslip: { columns: { id: true, bradfordFactorScore: true } },
      },
    });
    if (!snapshot) throw new Error("Snapshot not found");
    return snapshot;
  });
