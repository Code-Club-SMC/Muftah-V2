import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, compensatoryLedger, employees } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { buildOvertimeRequestSummary, getOvertimeStandardDutyHours } from "@/lib/attendance/overtime-request";
import { invalidateDeviceAttendanceChanges, lockAttendancePayrollWrites } from "@/lib/attendance/device-import/payroll.server";
import { lockEmployeePunchWrites } from "./punch-write-lock";
import { changeCompensatoryBalance } from "@/lib/attendance/compensatory-reservation.server";

export const processOvertimeFn = createServerFn()
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
            const compEntries = await tx.query.compensatoryLedger.findMany({
                where: and(
                    eq(compensatoryLedger.employeeId, row.employeeId),
                    or(
                        eq(compensatoryLedger.attendanceId, row.id),
                        and(
                            eq(compensatoryLedger.attendanceDate, row.date),
                            eq(compensatoryLedger.reason, "overtime_converted"),
                        ),
                    ),
                ),
            });

            const creditedHours = compEntries
                .filter((e) => e.reason === "overtime_converted")
                .reduce((sum, e) => sum + Number(e.changeHours), 0);

            const reversedHours = compEntries
                .filter(
                    (e) =>
                        (e.reason === "manual_adjustment" || e.reason === "auto_refund") &&
                        Number(e.changeHours) < 0 &&
                        (e.note?.includes("comp-off revoked") || e.note?.includes("Comp-off revoked")),
                )
                .reduce((sum, e) => sum + Math.abs(Number(e.changeHours)), 0);

            const netHoursToRevoke = Number((creditedHours - reversedHours).toFixed(2));

            if (netHoursToRevoke > 0) {
                const employee = await tx.query.employees.findFirst({
                    where: eq(employees.id, row.employeeId),
                    columns: { compensatoryHoursBalance: true },
                });
                const currentBalance = Number(employee?.compensatoryHoursBalance || "0");

                if (currentBalance < netHoursToRevoke) {
                    throw new Error(
                        `Cannot ${status === "rejected" ? "reject" : "reset"} this overtime: ` +
                        `${netHoursToRevoke} compensatory hours were credited, but the employee has already used them ` +
                        `(available balance: ${currentBalance}h). Adjust the employee's compensatory leave balance first.`,
                    );
                }

                await changeCompensatoryBalance(
                    tx,
                    row.employeeId,
                    -netHoursToRevoke,
                    "manual_adjustment",
                    {
                        attendanceId: row.id,
                        attendanceDate: row.date,
                        actorId: (context as any)?.session?.user?.id ?? null,
                        note:
                            status === "rejected"
                                ? "Comp-off revoked (overtime rejected)"
                                : "Comp-off revoked (overtime reset to pending)",
                    },
                );
            }
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
            .set({
                overtimeStatus: status,
                overtimeCompensationMethod: status === "approved" ? row.overtimeCompensationMethod : "payout",
                updatedAt: new Date(),
            })
            .where(eq(attendance.id, id))
            .returning();

        return updated;
      });
    });
