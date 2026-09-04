import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { buildOvertimeRequestSummary } from "@/lib/attendance/overtime-request";
import { calculateTotalShiftHours } from "@/lib/attendance/time";

export const getOvertimeApprovalsFn = createServerFn()
    .middleware([requireHrViewMiddleware])
    .inputValidator(
        z.object({
            status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
        }),
    )
    .handler(async ({ data: { status } }) => {
        const filters = [gt(attendance.overtimeHours, "0")];

        if (status !== "all") {
            filters.push(eq(attendance.overtimeStatus, status));
        } else {
            // All means everything that has OT > 0 and a status
            filters.push(inArray(attendance.overtimeStatus, [
                "pending",
                "approved",
                "rejected",
            ]));
        }

        const records = await db
            .select({
                id: attendance.id,
                employeeId: employees.id,
                employeeCode: employees.employeeCode,
                firstName: employees.firstName,
                lastName: employees.lastName,
                designation: employees.designation,
                standardDutyHours: employees.standardDutyHours,
                restDays: employees.restDays,
                shifts: employees.shifts,
                date: attendance.date,
                dutyHours: attendance.dutyHours,
                overtimeHours: attendance.overtimeHours,
                overtimeStatus: attendance.overtimeStatus,
                overtimeRemarks: attendance.overtimeRemarks,
            })
            .from(attendance)
            .innerJoin(employees, eq(attendance.employeeId, employees.id))
            .where(and(...filters))
            .orderBy(desc(attendance.date));

        const enrichedRecords = records.map((r) => {
            const configuredRestDays = Array.isArray(r.restDays) ? (r.restDays as number[]) : [0];
            const [year, month, day] = r.date.split("-").map(Number);
            const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
            const isRest = configuredRestDays.includes(dayOfWeek);
            const shiftHours = calculateTotalShiftHours(r.shifts as any);
            const baseStd = shiftHours > 0 ? shiftHours : (r.standardDutyHours || 8);
            const effectiveStandardDutyHours = isRest ? 0 : baseStd;

            const summary = buildOvertimeRequestSummary({
                dutyHours: r.dutyHours,
                standardDutyHours: effectiveStandardDutyHours,
                requestedOvertimeHours: r.overtimeHours,
            });
            return {
                ...r,
                isRestDay: isRest,
                standardDutyHours: summary.standardDutyHours,
                workedDutyHours: summary.workedDutyHours,
                suggestedOvertimeHours: summary.suggestedOvertimeHours,
                isOvertimeRequestStale: summary.state === "stale",
                overtimeRequestWarning: summary.warning,
            };
        });

        // Calculate quick stats
        const allRecords = await db
            .select({ overtimeStatus: attendance.overtimeStatus, overtimeHours: attendance.overtimeHours })
            .from(attendance)
            .where(gt(attendance.overtimeHours, "0"));

        const stats = {
            pendingRequests: 0,
            pendingHours: 0,
            approvedRequests: 0,
            approvedHours: 0,
            rejectedRequests: 0,
            rejectedHours: 0,
        };

        allRecords.forEach(r => {
            const hours = parseFloat(r.overtimeHours || "0");
            if (r.overtimeStatus === "pending") {
                stats.pendingRequests++;
                stats.pendingHours += hours;
            } else if (r.overtimeStatus === "approved") {
                stats.approvedRequests++;
                stats.approvedHours += hours;
            } else if (r.overtimeStatus === "rejected") {
                stats.rejectedRequests++;
                stats.rejectedHours += hours;
            }
        });

        return {
            records: enrichedRecords,
            stats,
        };
    });
