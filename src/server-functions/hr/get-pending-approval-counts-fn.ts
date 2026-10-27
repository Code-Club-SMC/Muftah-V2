import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, attendanceTimeExceptions, salaryAdvances } from "@/db/schemas/hr-schema";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { eq, and, gt } from "drizzle-orm";

/**
 * Returns counts of pending approvals across all approval types.
 * Used by the payroll module to warn admins before generating payslips.
 */
export const getPendingApprovalCountsFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .handler(async () => {
        // Pending overtime
        const pendingOT = await db
            .select({ id: attendance.id })
            .from(attendance)
            .where(
                and(
                    eq(attendance.overtimeStatus, "pending"),
                    gt(attendance.overtimeHours, "0")
                )
            );

        // Pending leave
        const pendingLeave = await db
            .select({ id: attendance.id })
            .from(attendance)
            .where(
                and(
                    eq(attendance.status, "leave"),
                    eq(attendance.leaveApprovalStatus, "pending")
                )
            );

        // Pending advances
        const pendingAdvances = await db
            .select({ id: salaryAdvances.id })
            .from(salaryAdvances)
            .where(eq(salaryAdvances.status, "pending"));

        // Pending late/early items on present days
        const pendingLateEarly = await db
            .select({ id: attendanceTimeExceptions.id })
            .from(attendanceTimeExceptions)
            .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
            .where(
                and(
                    eq(attendanceTimeExceptions.status, "pending"),
                    eq(attendance.status, "present")
                )
            );

        return {
            overtime: pendingOT.length,
            leave: pendingLeave.length,
            advances: pendingAdvances.length,
            lateEarly: pendingLateEarly.length,
            total:
                pendingOT.length +
                pendingLeave.length +
                pendingAdvances.length +
                pendingLateEarly.length,
        };
    });
