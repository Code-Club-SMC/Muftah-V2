import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  db,
  payrollAttendanceInvalidations,
  payrolls,
} from "@/db";

export type OfflineAttendanceInvalidationTx =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AttendanceInvalidationInput = {
  batchId: string;
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
    const existing =
      await tx.query.payrollAttendanceInvalidations.findFirst({
        where: and(
          eq(payrollAttendanceInvalidations.payrollId, payroll.id),
          eq(payrollAttendanceInvalidations.importBatchId, input.batchId),
          isNull(payrollAttendanceInvalidations.resolvedAt),
        ),
      });

    if (existing) {
      await tx
        .update(payrollAttendanceInvalidations)
        .set({
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
  const unresolved =
    await tx.query.payrollAttendanceInvalidations.findFirst({
      where: and(
        eq(payrollAttendanceInvalidations.payrollId, payrollId),
        isNull(payrollAttendanceInvalidations.resolvedAt),
      ),
    });

  if (unresolved) {
    throw new Error(
      "Payroll has offline attendance changes. Regenerate payslips before approval.",
    );
  }
}

export async function resolvePayrollAttendanceInvalidations(
  tx: OfflineAttendanceInvalidationTx,
  payrollId: string,
  actorId: string,
) {
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
      ),
    );
}
