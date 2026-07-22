import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildOvertimeRequestSummary } from "@/lib/attendance/overtime-request";

export const processOvertimeFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            id: z.string(),
            status: z.enum(["approved", "rejected", "pending"]),
        })
    )
    .handler(async ({ data: { id, status } }) => {
        const [row] = await db
            .select({
                id: attendance.id,
                dutyHours: attendance.dutyHours,
                overtimeHours: attendance.overtimeHours,
                overtimeStatus: attendance.overtimeStatus,
                standardDutyHours: employees.standardDutyHours,
            })
            .from(attendance)
            .innerJoin(employees, eq(attendance.employeeId, employees.id))
            .where(eq(attendance.id, id));

        if (!row) {
            throw new Error("Attendance record not found");
        }

        if (status === "approved") {
            const summary = buildOvertimeRequestSummary({
                dutyHours: row.dutyHours,
                standardDutyHours: row.standardDutyHours,
                requestedOvertimeHours: row.overtimeHours,
            });

            if (summary.state === "stale") {
                throw new Error(
                    summary.warning ||
                        "Cannot approve this overtime request because the requested hours exceed the latest suggested overtime. Ask HR/operator to recheck the attendance row.",
                );
            }
        }

        const [updated] = await db
            .update(attendance)
            .set({ overtimeStatus: status, updatedAt: new Date() })
            .where(eq(attendance.id, id))
            .returning();

        return updated;
    });
