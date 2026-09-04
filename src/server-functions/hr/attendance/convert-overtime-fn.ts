import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { createServerFn } from "@tanstack/react-start";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { differenceInMinutes, parse } from "date-fns";

const convertOvertimeSchema = z.object({
  employeeId: z.string(),
  attendanceIds: z.array(z.string()).min(1, "Select at least one record"),
});

export const convertOvertimeToCompOffFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator((data: unknown) => convertOvertimeSchema.parse(data))
  .handler(async ({ data }: { data: z.infer<typeof convertOvertimeSchema> }) => {
    return await db.transaction(async (tx) => {
      // 1. Fetch employee to get shift details
      const employee = await tx.query.employees.findFirst({
        where: eq(employees.id, data.employeeId),
      });

      if (!employee) {
        throw new Error("Employee not found");
      }

      // 2. Calculate minimum shift length dynamically
      let minShiftLengthHours = employee.standardDutyHours;
      if (employee.shifts && employee.shifts.length > 0) {
        let minMinutes = Infinity;
        for (const shift of employee.shifts) {
          const start = parse(shift.start, "HH:mm", new Date());
          const end = parse(shift.end, "HH:mm", new Date());
          const diff = differenceInMinutes(end, start);
          if (diff > 0 && diff < minMinutes) {
            minMinutes = diff;
          }
        }
        if (minMinutes !== Infinity) {
          minShiftLengthHours = minMinutes / 60;
        }
      }

      // 3. Fetch selected attendance records
      const records = await tx.query.attendance.findMany({
        where: inArray(attendance.id, data.attendanceIds),
      });

      if (records.length !== data.attendanceIds.length) {
        throw new Error("Some attendance records were not found");
      }

      // 4. Sum up valid overtime hours
      let totalOvertimeHours = 0;
      for (const record of records) {
        if (record.employeeId !== data.employeeId) {
          throw new Error("Mismatch in employee records");
        }
        if (record.overtimeCompensationMethod === "comp_off") {
          throw new Error("One or more records are already converted to Comp Off");
        }
        const hours = parseFloat(record.overtimeHours || "0");
        if (hours <= 0) {
          throw new Error("Selected records must have valid overtime hours");
        }
        totalOvertimeHours += hours;
      }

      // 5. Validation Check
      if (totalOvertimeHours < minShiftLengthHours) {
        throw new Error(
          `Insufficient overtime hours. You have selected ${totalOvertimeHours} hours, but a minimum of ${minShiftLengthHours} hours (one shift) is required to convert.`,
        );
      }

      // 6. Conversion
      // Mark these records as comp_off
      await tx
        .update(attendance)
        .set({
          overtimeCompensationMethod: "comp_off",
          overtimeStatus: "approved",
        })
        .where(inArray(attendance.id, data.attendanceIds));

      // Add to balance
      await tx
        .update(employees)
        .set({
          compensatoryHoursBalance: sql`COALESCE(${employees.compensatoryHoursBalance}, 0) + ${totalOvertimeHours}`,
        })
        .where(eq(employees.id, data.employeeId));

      return {
        success: true,
        message: `Successfully converted ${totalOvertimeHours} overtime hours to Compensatory Leave.`,
      };
    });
  });
