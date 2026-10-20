import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  payrolls,
} from "@/db/schemas/hr-schema";
import { deviceAttendancePunchClaims } from "@/db/schemas/device-attendance-schema";
import { invalidateDraftPayrollsForAttendance } from "../offline/payroll-invalidation.server";
import { isPunchTimelineValid } from "../punch-sequence";
import { nowPKTDate } from "../time";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "query"> | Pick<Tx, "query">;

// One factory's HR uploads and payroll approval serialize here. Employee locks follow it.
export async function lockAttendancePayrollWrites(tx: Tx) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('attendance_payroll_write'))`,
  );
}

export async function assertAttendanceDatesEditable(tx: Tx, dates: string[]) {
  if (!dates.length) return;
  const locked = await tx.query.payrolls.findMany({
    where: and(
      lte(payrolls.startDate, [...dates].sort().at(-1)!),
      gte(payrolls.endDate, [...dates].sort()[0]),
      inArray(payrolls.status, ["approved", "paid"]),
    ),
  });
  if (
    locked.some((p) => dates.some((d) => p.startDate <= d && p.endDate >= d))
  ) {
    throw new Error(
      "Attendance belongs to approved or paid payroll. Use the payroll correction workflow.",
    );
  }
}

export async function invalidateDeviceAttendanceChanges(
  tx: Tx,
  employeeId: string,
  dates: string[],
) {
  if (!dates.length) return;
  const claims = await tx.query.deviceAttendancePunchClaims.findMany({
    where: and(
      eq(deviceAttendancePunchClaims.employeeId, employeeId),
      inArray(deviceAttendancePunchClaims.attendanceDate, dates),
    ),
  });
  const affectedDates = [...new Set(dates)];
  await assertAttendanceDatesEditable(tx, affectedDates);
  for (const date of affectedDates) {
    const claim = claims.find((c) => c.attendanceDate === date) ?? claims[0];
    const input = { employeeId, attendanceDate: date };
    await invalidateDraftPayrollsForAttendance(
      tx,
      claim ? { ...input, deviceImportId: claim.importId } : input,
    );
  }
}

export async function assertDeviceAttendanceResolved(
  reader: Reader,
  employeeId: string,
  startDate: string,
  endDate: string,
) {
  const claims = await reader.query.deviceAttendancePunchClaims.findMany({
    where: and(
      eq(deviceAttendancePunchClaims.employeeId, employeeId),
      gte(deviceAttendancePunchClaims.attendanceDate, startDate),
      lte(deviceAttendancePunchClaims.attendanceDate, endDate),
    ),
  });
  const dates = [...new Set(claims.map((c) => c.attendanceDate))].filter(
    (d) => d < nowPKTDate(),
  );
  if (!dates.length) return;
  const [punches, records] = await Promise.all([
    reader.query.attendancePunches.findMany({
      where: and(
        eq(attendancePunches.employeeId, employeeId),
        inArray(attendancePunches.attendanceDate, dates),
      ),
      orderBy: [asc(attendancePunches.timestamp)],
    }),
    reader.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        inArray(attendance.date, dates),
      ),
    }),
  ]);
  for (const date of dates) {
    const record = records.find((r) => r.date === date);
    if (record && record.status !== "present") continue; // HR explicitly resolved this date.
    const day = punches.filter((p) => p.attendanceDate === date);
    if (
      !record ||
      day.length === 0 ||
      day.at(-1)?.direction === "in" ||
      !isPunchTimelineValid(day)
    ) {
      throw new Error(
        `Attendance on ${date} needs HR review. Correct the punches or resolve the daily status before payroll.`,
      );
    }
  }
}
