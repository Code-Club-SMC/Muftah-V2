import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { attendancePunches, employees } from "@/db/schemas/hr-schema";

export const getDailyAttendanceFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ date: z.string() }))
  .handler(async ({ data }) => {
    const { date } = data;

    const allEmployees = await db.query.employees.findMany({
      where: and(
        eq(employees.isSalesman, false),
        inArray(employees.status, ["active", "on_leave"]),
        lte(employees.joiningDate, date),
      ),
      with: {
        attendance: {
          where: (table, { eq }) => eq(table.date, date),
        },
      },
      orderBy: (table, { asc }) => [asc(table.firstName), asc(table.lastName)],
    });

    const punchDrivenEmployeeIds = allEmployees
      .filter((employee) => !employee.isOrderBooker)
      .map((employee) => employee.id);

    const punches =
      punchDrivenEmployeeIds.length > 0
        ? await db.query.attendancePunches.findMany({
            where: and(
              inArray(attendancePunches.employeeId, punchDrivenEmployeeIds),
              eq(attendancePunches.attendanceDate, date),
            ),
            orderBy: [asc(attendancePunches.timestamp)],
          })
        : [];

    const punchesByEmployee = new Map<string, typeof punches>();
    for (const punch of punches) {
      const current = punchesByEmployee.get(punch.employeeId) ?? [];
      current.push(punch);
      punchesByEmployee.set(punch.employeeId, current);
    }

    return allEmployees.map((employee) => ({
      ...employee,
      dailyPunches: punchesByEmployee.get(employee.id) ?? [],
    }));
  });
