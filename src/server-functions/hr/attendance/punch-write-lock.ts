import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendancePunches } from "@/db/schemas/hr-schema";

export type AttendancePunchWriteTx =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockEmployeePunchWrites(
  tx: AttendancePunchWriteTx,
  employeeId: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`attendance_punch_employee:${employeeId}`}))`,
  );
}

export async function listPunchesForDate(
  tx: AttendancePunchWriteTx,
  employeeId: string,
  attendanceDate: string,
  excludePunchId?: string,
) {
  return await tx.query.attendancePunches.findMany({
    where: excludePunchId
      ? and(
          eq(attendancePunches.employeeId, employeeId),
          eq(attendancePunches.attendanceDate, attendanceDate),
          ne(attendancePunches.id, excludePunchId),
        )
      : and(
          eq(attendancePunches.employeeId, employeeId),
          eq(attendancePunches.attendanceDate, attendanceDate),
        ),
    columns: {
      id: true,
      direction: true,
      timestamp: true,
    },
    orderBy: (table) => [
      asc(table.timestamp),
      asc(table.createdAt),
      asc(table.id),
    ],
  });
}
