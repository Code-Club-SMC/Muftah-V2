import { and, countDistinct, eq, exists, gte, inArray, lte, not, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { attendance, attendanceTimeExceptions, payrolls } from "@/db/schemas/hr-schema";
import type { AttendanceTx } from "./recompute-server";
import type { ShiftViolation } from "./recompute";
import { buildDesiredTimeExceptions, reconcileTimeExceptions } from "./time-exceptions";

export async function syncAttendanceTimeExceptions(
  tx: AttendanceTx,
  row: { id: string; employeeId: string; date: string },
  violations: ShiftViolation[],
) {
  const existing = await tx.query.attendanceTimeExceptions.findMany({
    where: eq(attendanceTimeExceptions.attendanceId, row.id),
  });
  const plan = reconcileTimeExceptions(existing, buildDesiredTimeExceptions(violations));
  const now = new Date();

  if (plan.deleteIds.length) {
    await tx.delete(attendanceTimeExceptions).where(inArray(attendanceTimeExceptions.id, plan.deleteIds));
  }

  for (const update of plan.updates) {
    const previous = existing.find((item) => item.id === update.id)!;
    await tx
      .update(attendanceTimeExceptions)
      .set({
        minutes: update.minutes,
        status: update.status,
        ...(update.statusChanged
          ? {
              note: null,
              decidedBy: null,
              decidedAt: null,
              history: [
                ...previous.history,
                { status: update.status, note: "Recomputed from punches", decidedBy: null, decidedAt: now.toISOString() },
              ],
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(attendanceTimeExceptions.id, update.id));
  }

  if (plan.inserts.length) {
    await tx.insert(attendanceTimeExceptions).values(
      plan.inserts.map((item) => ({
        attendanceId: row.id,
        employeeId: row.employeeId,
        date: row.date,
        ...item,
      })),
    );
  }
}

/**
 * Items still waiting for a decision: pending, on a present day, and not inside
 * approved or paid payroll (those can no longer be decided). Needs a join to `attendance`.
 */
export function openPendingTimeExceptionFilter(): SQL {
  return and(
    eq(attendanceTimeExceptions.status, "pending"),
    eq(attendance.status, "present"),
    not(
      exists(
        db
          .select({ id: payrolls.id })
          .from(payrolls)
          .where(
            and(
              inArray(payrolls.status, ["approved", "paid"]),
              lte(payrolls.startDate, attendanceTimeExceptions.date),
              gte(payrolls.endDate, attendanceTimeExceptions.date),
            ),
          ),
      ),
    ),
  )!;
}

export async function countOpenPendingTimeExceptions() {
  const [row] = await db
    .select({
      items: countDistinct(attendanceTimeExceptions.id),
      employees: countDistinct(attendanceTimeExceptions.employeeId),
    })
    .from(attendanceTimeExceptions)
    .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
    .where(openPendingTimeExceptionFilter());
  return { items: row?.items ?? 0, employees: row?.employees ?? 0 };
}
