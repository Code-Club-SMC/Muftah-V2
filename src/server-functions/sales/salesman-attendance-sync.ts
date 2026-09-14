import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import {
  creditRecoveryAttempts,
  orders,
  salesmen,
} from "@/db/schemas/sales-erp-schema";

export const SALESMAN_ACTIVITY_ENTRY_SOURCE = "salesman_activity" as const;

export type SalesDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SalesDbExecutor = typeof db | SalesDbTransaction;

export function getSalesmanBusinessDateRange(businessDate: string): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(`${businessDate}T00:00:00+05:00`);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

export async function syncSalesmanAttendanceForDate(args: {
  tx: SalesDbTransaction;
  salesmanId: string;
  businessDate: string;
  standardDutyHours?: number;
}): Promise<{ status: "synced" | "skipped_manual" | "deleted" | "no_op" }> {
  const salesman = await args.tx.query.salesmen.findFirst({
    where: eq(salesmen.id, args.salesmanId),
    columns: { id: true, employeeId: true },
  });

  if (!salesman || !salesman.employeeId) {
    return { status: "no_op" };
  }

  const employee = await args.tx.query.employees.findFirst({
    where: eq(employees.id, salesman.employeeId),
    columns: { id: true, standardDutyHours: true, status: true },
  });

  if (!employee || employee.status !== "active") {
    return { status: "no_op" };
  }

  const { start, endExclusive } = getSalesmanBusinessDateRange(args.businessDate);

  const [existingAttendance, deliveryCountResult, recoveryCountResult] =
    await Promise.all([
      args.tx.query.attendance.findFirst({
        where: and(
          eq(attendance.employeeId, employee.id),
          eq(attendance.date, args.businessDate),
        ),
      }),
      args.tx
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.fulfilledBySalesmanId, args.salesmanId),
            eq(orders.status, "delivered"),
            gte(orders.fulfilledAt, start),
            lt(orders.fulfilledAt, endExclusive),
          ),
        ),
      args.tx
        .select({ count: sql<number>`count(*)` })
        .from(creditRecoveryAttempts)
        .where(
          and(
            eq(creditRecoveryAttempts.assignedToId, args.salesmanId),
            gte(creditRecoveryAttempts.attemptedAt, start),
            lt(creditRecoveryAttempts.attemptedAt, endExclusive),
          ),
        ),
    ]);

  // HR Precedence: Protect manual HR records from overwrite
  if (
    existingAttendance &&
    existingAttendance.entrySource !== SALESMAN_ACTIVITY_ENTRY_SOURCE
  ) {
    return { status: "skipped_manual" };
  }

  const totalActivities =
    Number(deliveryCountResult[0]?.count || 0) +
    Number(recoveryCountResult[0]?.count || 0);

  if (totalActivities === 0) {
    if (
      existingAttendance &&
      existingAttendance.entrySource === SALESMAN_ACTIVITY_ENTRY_SOURCE
    ) {
      await args.tx
        .delete(attendance)
        .where(eq(attendance.id, existingAttendance.id));
      return { status: "deleted" };
    }
    return { status: "no_op" };
  }

  const dutyHours = Math.max(
    args.standardDutyHours ??
      (employee.standardDutyHours != null
        ? Number(employee.standardDutyHours)
        : 8),
    0,
  ).toFixed(2);

  const now = new Date();

  await args.tx
    .insert(attendance)
    .values({
      employeeId: employee.id,
      date: args.businessDate,
      status: "present",
      checkIn: null,
      checkOut: null,
      dutyHours,
      overtimeHours: "0.00",
      isLate: false,
      isNightShift: false,
      overtimeStatus: "pending",
      overtimeRemarks: null,
      earlyDepartureStatus: "none",
      checkOutReason: null,
      shiftViolations: [],
      isApprovedLeave: false,
      leaveApprovalStatus: "none",
      leaveType: null,
      entrySource: SALESMAN_ACTIVITY_ENTRY_SOURCE,
      notes: "Auto-synced from field activities (deliveries/recoveries)",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [attendance.employeeId, attendance.date],
      set: {
        status: "present",
        checkIn: null,
        checkOut: null,
        dutyHours,
        entrySource: SALESMAN_ACTIVITY_ENTRY_SOURCE,
        updatedAt: now,
      },
    });

  return { status: "synced" };
}
