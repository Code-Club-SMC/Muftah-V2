import { eq, inArray } from "drizzle-orm";
import { attendanceTimeExceptions } from "@/db/schemas/hr-schema";
import type { AttendanceTx } from "./recompute-server";
import type { ShiftViolation } from "./recompute";
import { buildDesiredTimeExceptions, reconcileTimeExceptions } from "./time-exceptions";

export async function syncAttendanceTimeExceptions(
  tx: AttendanceTx,
  row: { id: string; employeeId: string; date: string },
  violations: ShiftViolation[],
  options: { reset?: boolean } = {},
) {
  if (options.reset) {
    await tx.delete(attendanceTimeExceptions).where(eq(attendanceTimeExceptions.attendanceId, row.id));
  }

  const existing = options.reset
    ? []
    : await tx.query.attendanceTimeExceptions.findMany({
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
