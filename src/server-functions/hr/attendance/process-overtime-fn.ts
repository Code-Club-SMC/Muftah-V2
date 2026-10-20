import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildOvertimeRequestSummary, getOvertimeStandardDutyHours } from "@/lib/attendance/overtime-request";
import { invalidateDeviceAttendanceChanges, lockAttendancePayrollWrites } from "@/lib/attendance/device-import/payroll.server";
import { lockEmployeePunchWrites } from "./punch-write-lock";

export const processOvertimeFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            id: z.string(),
            status: z.enum(["approved", "rejected", "pending"]),
        })
    )
    .handler(async ({ data: { id, status } }) => {
      return await db.transaction(async (tx) => {
        await lockAttendancePayrollWrites(tx);
        const [row] = await tx
            .select({
                id: attendance.id,
                employeeId: attendance.employeeId,
                date: attendance.date,
                dutyHours: attendance.dutyHours,
                overtimeHours: attendance.overtimeHours,
                overtimeStatus: attendance.overtimeStatus,
                overtimeCompensationMethod: attendance.overtimeCompensationMethod,
                standardDutyHours: employees.standardDutyHours,
                restDays: employees.restDays,
                shifts: employees.shifts,
            })
            .from(attendance)
            .innerJoin(employees, eq(attendance.employeeId, employees.id))
            .where(eq(attendance.id, id));

        if (!row) {
            throw new Error("Attendance record not found");
        }
        await lockEmployeePunchWrites(tx, row.employeeId);
        await invalidateDeviceAttendanceChanges(tx, row.employeeId, [row.date]);
        if (row.overtimeCompensationMethod === "comp_off" && status !== "approved") {
            throw new Error("Converted overtime cannot change approval because compensatory hours have already been credited.");
        }

        if (status === "approved") {
            const summary = buildOvertimeRequestSummary({
                dutyHours: row.dutyHours,
                standardDutyHours: getOvertimeStandardDutyHours(row.date, row),
                requestedOvertimeHours: row.overtimeHours,
            });

            if (summary.state === "stale") {
                throw new Error(
                    summary.warning ||
                        "Cannot approve this overtime request because the requested hours exceed the latest suggested overtime. Ask HR/operator to recheck the attendance row.",
                );
            }
        }

        const [updated] = await tx
            .update(attendance)
            .set({ overtimeStatus: status, updatedAt: new Date() })
            .where(eq(attendance.id, id))
            .returning();

        return updated;
      });
    });
