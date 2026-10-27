import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  employees,
  payrolls,
} from "@/db/schemas/hr-schema";
import { nowPKTDate } from "@/lib/attendance/time";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, asc, between, eq, gte, inArray, lte } from "drizzle-orm";

export const getEmployeeAttendanceLogFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(
    z.object({
      employeeId: z.string(),
      startDate: z.string(), // YYYY-MM-DD
      endDate: z.string(), // YYYY-MM-DD
    }),
  )
  .handler(async ({ data }) => {
    const { employeeId, startDate, endDate } = data;

    const employee = await db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
    });

    if (!employee) throw new Error("Employee not found");

    const records = await db.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        between(attendance.date, startDate, endDate),
      ),
      orderBy: asc(attendance.date),
      with: { timeExceptions: { columns: { kind: true, minutes: true, status: true } } },
    });

    const punches = await db.query.attendancePunches.findMany({
      where: and(
        eq(attendancePunches.employeeId, employeeId),
        between(attendancePunches.attendanceDate, startDate, endDate),
      ),
      orderBy: [
        asc(attendancePunches.attendanceDate),
        asc(attendancePunches.timestamp),
      ],
    });

    const lockedPayrolls = await db.query.payrolls.findMany({
      where: and(
        lte(payrolls.startDate, endDate),
        gte(payrolls.endDate, startDate),
        inArray(payrolls.status, ["approved", "paid"]),
      ),
      columns: { startDate: true, endDate: true },
    });

    const punchesByDate = punches.reduce<Record<string, typeof punches>>(
      (acc, punch) => {
        if (!acc[punch.attendanceDate]) {
          acc[punch.attendanceDate] = [];
        }
        acc[punch.attendanceDate].push(punch);
        return acc;
      },
      {},
    );

    return {
      employee,
      records,
      punchesByDate,
      lockedPayrolls,
      today: nowPKTDate(),
    };
  });
