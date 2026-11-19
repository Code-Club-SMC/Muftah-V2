import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { createServerFn } from "@tanstack/react-start";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { COMP_OFF_NO_SHIFT_MESSAGE, shortestShiftHours } from "@/lib/attendance/time";
import { invalidateDeviceAttendanceChanges, lockAttendancePayrollWrites } from "@/lib/attendance/device-import/payroll.server";
import { lockEmployeePunchWrites } from "./punch-write-lock";
import { changeCompensatoryBalance } from "@/lib/attendance/compensatory-reservation.server";
import { buildOvertimeRequestSummary, getOvertimeStandardDutyHours } from "@/lib/attendance/overtime-request";

const convertOvertimeSchema = z.object({
  employeeId: z.string(),
  attendanceIds: z.array(z.string()).min(1, "Select at least one record"),
});

export const convertOvertimeToCompOffFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator((data: unknown) => convertOvertimeSchema.parse(data))
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      await lockEmployeePunchWrites(tx, data.employeeId);
      // 1. Fetch employee to get shift details
      const employee = await tx.query.employees.findFirst({
        where: eq(employees.id, data.employeeId),
      });

      if (!employee) {
        throw new Error("Employee not found");
      }

      // 2. One comp-off day is worth the employee's shortest scheduled shift.
      const minShiftLengthHours = shortestShiftHours(employee.shifts);
      if (minShiftLengthHours === null) {
        throw new Error(COMP_OFF_NO_SHIFT_MESSAGE);
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
        if (!Number.isFinite(hours) || hours <= 0 || record.status !== "present") {
          throw new Error("Selected records must have valid overtime hours");
        }
        const summary = buildOvertimeRequestSummary({ dutyHours: record.dutyHours,
          standardDutyHours: getOvertimeStandardDutyHours(record.date, employee), requestedOvertimeHours: record.overtimeHours });
        if (summary.state === "stale") throw new Error(summary.warning || "Requested overtime exceeds worked hours.");
        totalOvertimeHours += hours;
      }

      // 5. Validation Check
      if (totalOvertimeHours < minShiftLengthHours) {
        throw new Error(
          `Insufficient overtime hours. You have selected ${totalOvertimeHours} hours, but one shift for this employee is ${minShiftLengthHours} hours. Select more overtime days to reach it.`,
        );
      }

      // 6. Conversion
      await invalidateDeviceAttendanceChanges(tx, data.employeeId, records.map(row => row.date));
      // Mark these records as comp_off
      await tx
        .update(attendance)
        .set({
          overtimeCompensationMethod: "comp_off",
          overtimeStatus: "approved",
        })
        .where(inArray(attendance.id, data.attendanceIds));

      // Add to balance, one history row per converted day.
      for (const record of records) {
        await changeCompensatoryBalance(tx, data.employeeId, parseFloat(record.overtimeHours || "0"), "overtime_converted", {
          attendanceId: record.id,
          attendanceDate: record.date,
          actorId: context.session.user.id,
        });
      }

      return {
        success: true,
        message: `Successfully converted ${totalOvertimeHours} overtime hours to Compensatory Leave.`,
      };
    });
  });
