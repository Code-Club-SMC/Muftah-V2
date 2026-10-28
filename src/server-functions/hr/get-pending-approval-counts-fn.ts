import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, salaryAdvances } from "@/db/schemas/hr-schema";
import { countOpenPendingTimeExceptions } from "@/lib/attendance/time-exceptions.server";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq, and, gt } from "drizzle-orm";

/**
 * Returns counts of pending approvals across all approval types.
 * Used by the payroll module to warn admins before generating payslips.
 */
export const getPendingApprovalCountsFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .handler(async ({ context }) => {
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

        // Pending late/early items. Only HR approvers decide them, so only they see the count.
        const lateEarly = hasPermission(context.authContext.permissions, "hr.manage")
            ? await countOpenPendingTimeExceptions()
            : { items: 0, employees: 0 };

        return {
            overtime: pendingOT.length,
            leave: pendingLeave.length,
            advances: pendingAdvances.length,
            lateEarly: lateEarly.items,
            lateEarlyEmployees: lateEarly.employees,
            total:
                pendingOT.length +
                pendingLeave.length +
                pendingAdvances.length +
                lateEarly.items,
        };
    });
