import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, attendancePunches, employees } from "@/db/schemas/hr-schema";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, asc, between, eq } from "drizzle-orm";

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
    };
  });
