import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import {
    requireHrManageMiddleware,
    requireHrViewMiddleware,
} from "@/lib/middlewares";
import { eq, and, desc, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { invalidateDeviceAttendanceChanges, lockAttendancePayrollWrites } from "@/lib/attendance/device-import/payroll.server";
import { lockEmployeePunchWrites } from "./punch-write-lock";
import { assertWorkingLeaveDate, isWorkingLeaveDate } from "@/lib/attendance/leave-policy";
import { adjustCompensatoryReservation } from "@/lib/attendance/compensatory-reservation.server";

/**
 * Fetch leave records that need admin approval
 */
export const getLeaveApprovalsFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .inputValidator(
        z.object({
            status: z
                .enum(["pending", "approved", "rejected", "all"])
                .default("pending"),
        })
    )
    .handler(async ({ data: { status } }) => {
        const filters = [eq(attendance.status, "leave")];

        if (status !== "all") {
            filters.push(eq(attendance.leaveApprovalStatus, status));
        }

        const records = await db
            .select({
                id: attendance.id,
                employeeId: employees.id,
                employeeCode: employees.employeeCode,
                firstName: employees.firstName,
                lastName: employees.lastName,
                designation: employees.designation,
                date: attendance.date,
                leaveType: attendance.leaveType,
                leaveApprovalStatus: attendance.leaveApprovalStatus,
                isApprovedLeave: attendance.isApprovedLeave,
                notes: attendance.notes,
            })
            .from(attendance)
            .innerJoin(employees, eq(attendance.employeeId, employees.id))
            .where(and(...filters))
            .orderBy(desc(attendance.date));

        // Stats
        const allLeaves = await db
            .select({
                leaveApprovalStatus: attendance.leaveApprovalStatus,
            })
            .from(attendance)
            .where(eq(attendance.status, "leave"));

        const stats = {
            pendingCount: 0,
            approvedCount: 0,
            rejectedCount: 0,
        };

        allLeaves.forEach((r) => {
            if (r.leaveApprovalStatus === "pending") stats.pendingCount++;
            else if (r.leaveApprovalStatus === "approved") stats.approvedCount++;
            else if (r.leaveApprovalStatus === "rejected") stats.rejectedCount++;
        });

        return { records, stats };
    });

/**
 * Process (approve/reject) a leave request.
 * Approval and paid eligibility are separate; configured deduction flags still apply.
 */
export const processLeaveApprovalFn = createServerFn()
    .middleware([requireHrManageMiddleware])
    .inputValidator(
        z.object({
            id: z.string(),
            status: z.enum(["approved", "rejected", "pending"]),
        })
    )
    .handler(async ({ data: { id, status }, context }) => {
        return await db.transaction(async (tx) => {
            await lockAttendancePayrollWrites(tx);
            const leave = await tx.query.attendance.findFirst({
                where: eq(attendance.id, id),
            });
            if (!leave) throw new Error("Leave request not found");
            if (leave.status !== "leave" || !leave.leaveType) {
                throw new Error("Only typed leave records can be processed.");
            }
            await lockEmployeePunchWrites(tx, leave.employeeId);
            await invalidateDeviceAttendanceChanges(tx, leave.employeeId, [leave.date]);

            const employee = await tx.query.employees.findFirst({
                where: eq(employees.id, leave.employeeId),
            });
            if (!employee) throw new Error("Employee not found");
            if (status !== "rejected") {
                assertWorkingLeaveDate(leave.date, employee.restDays);
            }
            const compensatoryHoursUsed = status === "rejected" && leave.leaveType === "compensatory"
                ? "0" : leave.compensatoryHoursUsed;
            if (leave.leaveType === "compensatory") {
                await adjustCompensatoryReservation(tx, leave.employeeId, leave.compensatoryHoursUsed, compensatoryHoursUsed);
            }

            let paidApproval = status === "approved";

            if (status === "approved" && leave.leaveType === "annual") {
                const leaveYear = leave.date.substring(0, 4);
                const annualAllowance = employee.annualLeaveAllowance ?? 14;
                const approvedAnnualLeaves = await tx.query.attendance.findMany({
                    where: and(
                        eq(attendance.employeeId, leave.employeeId),
                        eq(attendance.status, "leave"),
                        eq(attendance.leaveType, "annual"),
                        eq(attendance.isApprovedLeave, true),
                        ne(attendance.id, id),
                        gte(attendance.date, `${leaveYear}-01-01`),
                        lte(attendance.date, `${leaveYear}-12-31`),
                    ),
                    columns: { id: true, date: true },
                });

                paidApproval = approvedAnnualLeaves.filter(row => isWorkingLeaveDate(row.date, employee.restDays)).length < annualAllowance;
            }

            const [updated] = await tx
                .update(attendance)
                .set({
                    leaveApprovalStatus: status,
                    isApprovedLeave: paidApproval,
                    compensatoryHoursUsed,
                    notes:
                        status === "approved" && leave.leaveType === "annual" && !paidApproval
                            ? [leave.notes, "Annual leave allowance exhausted; approved as unpaid annual leave."]
                                .filter(Boolean)
                                .join("\n")
                            : leave.notes,
                    updatedAt: new Date(),
                })
                .where(eq(attendance.id, id))
                .returning();

            if (leave.leaveType === "annual") {
                const leaveYear = leave.date.substring(0, 4);
                const approvedPaidAnnualLeaves = await tx.query.attendance.findMany({
                    where: and(
                        eq(attendance.employeeId, leave.employeeId),
                        eq(attendance.status, "leave"),
                        eq(attendance.leaveType, "annual"),
                        eq(attendance.isApprovedLeave, true),
                        gte(attendance.date, `${leaveYear}-01-01`),
                        lte(attendance.date, `${leaveYear}-12-31`),
                    ),
                    columns: { id: true, date: true },
                });

                await tx
                    .update(employees)
                    .set({
                        annualLeaveBalance: Math.max(
                            0,
                            (employee.annualLeaveAllowance ?? 14) -
                            approvedPaidAnnualLeaves.filter(row => isWorkingLeaveDate(row.date, employee.restDays)).length,
                        ),
                        leaveYearStart: `${leaveYear}-01-01`,
                    })
                    .where(eq(employees.id, leave.employeeId));
            }

            logActivityQuiet({
                module: "hr",
                action: status === "approved" ? "approved" : status === "rejected" ? "rejected" : "updated",
                entityType: "leave_request",
                actorId: context.session.user.id,
                actorName: context.session.user.name,
                description: `${status.charAt(0).toUpperCase() + status.slice(1)} leave request for ${employee.firstName} ${employee.lastName} on ${leave.date}`,
            });

            return updated;
        });
    });
