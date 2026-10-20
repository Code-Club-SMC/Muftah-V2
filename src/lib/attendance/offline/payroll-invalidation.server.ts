import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, payrollAttendanceInvalidations, payrolls } from "@/db";

export type OfflineAttendanceInvalidationTx = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type AttendanceInvalidationInput = (
  | { batchId: string; deviceImportId?: never }
  | { deviceImportId: string; batchId?: never }
  | { batchId?: never; deviceImportId?: never }
) & {
  employeeId: string;
  attendanceDate: string;
};

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

export async function invalidateDraftPayrollsForAttendance(
  tx: OfflineAttendanceInvalidationTx,
  input: AttendanceInvalidationInput,
) {
  const draftPayrolls = await tx.query.payrolls.findMany({
    where: and(
      eq(payrolls.status, "draft"),
      lte(payrolls.startDate, input.attendanceDate),
      gte(payrolls.endDate, input.attendanceDate),
    ),
  });

  for (const payroll of draftPayrolls) {
    const existing = await tx.query.payrollAttendanceInvalidations.findFirst({
      where: and(
        eq(payrollAttendanceInvalidations.payrollId, payroll.id),
        input.deviceImportId
          ? eq(
              payrollAttendanceInvalidations.deviceImportId,
              input.deviceImportId,
            )
          : input.batchId
            ? eq(payrollAttendanceInvalidations.importBatchId, input.batchId)
            : and(
                isNull(payrollAttendanceInvalidations.importBatchId),
                isNull(payrollAttendanceInvalidations.deviceImportId),
              ),
        isNull(payrollAttendanceInvalidations.resolvedAt),
      ),
    });

    if (existing) {
      await tx
        .update(payrollAttendanceInvalidations)
        .set({
          revision: sql`${payrollAttendanceInvalidations.revision} + 1`,
          affectedSummary: {
            employeeIds: unique([
              ...existing.affectedSummary.employeeIds,
              input.employeeId,
            ]),
            attendanceDates: unique([
              ...existing.affectedSummary.attendanceDates,
              input.attendanceDate,
            ]),
          },
        })
        .where(eq(payrollAttendanceInvalidations.id, existing.id));
      continue;
    }

    await tx.insert(payrollAttendanceInvalidations).values({
      payrollId: payroll.id,
      importBatchId: input.batchId,
      deviceImportId: input.deviceImportId,
      affectedSummary: {
        employeeIds: [input.employeeId],
        attendanceDates: [input.attendanceDate],
      },
    });
  }
}

export async function assertPayrollAttendanceCurrent(
  tx: OfflineAttendanceInvalidationTx,
  payrollId: string,
) {
  const unresolved = await tx.query.payrollAttendanceInvalidations.findFirst({
    where: and(
      eq(payrollAttendanceInvalidations.payrollId, payrollId),
      isNull(payrollAttendanceInvalidations.resolvedAt),
    ),
  });

  if (unresolved) {
    throw new Error(
      "Payroll has attendance changes. Regenerate payslips before approval.",
    );
  }
}

export async function resolvePayrollAttendanceInvalidations(
  tx: OfflineAttendanceInvalidationTx,
  payrollId: string,
  actorId: string,
  snapshots?: { id: string; revision: number }[],
) {
  if (snapshots?.length === 0) return;
  await tx
    .update(payrollAttendanceInvalidations)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId: actorId,
    })
    .where(
      and(
        eq(payrollAttendanceInvalidations.payrollId, payrollId),
        isNull(payrollAttendanceInvalidations.resolvedAt),
        snapshots
          ? or(
              ...snapshots.map((snapshot) =>
                and(
                  eq(payrollAttendanceInvalidations.id, snapshot.id),
                  eq(
                    payrollAttendanceInvalidations.revision,
                    snapshot.revision,
                  ),
                ),
              ),
            )
          : undefined,
      ),
    );
}
