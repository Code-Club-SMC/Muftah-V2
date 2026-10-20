import { eq, and } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { lockEmployeePunchWrites } from "./punch-write-lock";
import { invalidateDeviceAttendanceChanges, lockAttendancePayrollWrites } from "@/lib/attendance/device-import/payroll.server";
import { assertWorkingLeaveDate } from "@/lib/attendance/leave-policy";
import { adjustCompensatoryReservation } from "@/lib/attendance/compensatory-reservation.server";

export const bulkMarkAttendanceFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z
      .object({
        employeeIds: z.array(z.string()),
        date: z.string(),
        status: z.enum(["present", "absent", "leave", "holiday"]),
        leaveType: z.enum(["sick", "annual", "special", "compensatory"]).nullable().optional(),
      })
      .refine((data) => data.status !== "leave" || !!data.leaveType, {
        message: "Leave type is required when status is leave",
        path: ["leaveType"],
      }),
  )
  .handler(async ({ data }) => {
    const { employeeIds, date, status, leaveType } = data;

    // 1. Fetch employees to get their standardHours
    const employeesList = await db.query.employees.findMany({
      where: (table, { inArray }) => inArray(table.id, employeeIds),
    });

    const getDutyHours = (empId: string) => {
      const employee = employeesList.find((e) => e.id === empId);
      const standard = employee?.standardDutyHours || 8;
      if (status === "present") return standard.toFixed(2);
      return "0.00";
    };

    const buildNormalizedAttendancePayload = (employeeId: string) => ({
      status,
      checkIn: null,
      checkOut: null,
      dutyHours: getDutyHours(employeeId),
      overtimeHours: "0.00",
      isLate: false,
      isNightShift: false,
      isApprovedLeave: false,
      leaveType: status === "leave" ? leaveType : null,
      leaveApprovalStatus: status === "leave" ? "pending" : "none",
      earlyDepartureStatus: "none",
      checkOutReason: null,
      compensatoryHoursUsed: "0",
      overtimeRemarks: null,
      overtimeStatus: "pending",
      entrySource: "manual",
      notes: null,
      updatedAt: new Date(),
    });

    await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      for (const employeeId of [...employeeIds].sort()) {
        await lockEmployeePunchWrites(tx, employeeId);
      }
      for (const employeeId of employeeIds) {
        const payload = buildNormalizedAttendancePayload(employeeId);
        
        // Handle potential compensatory balance refund
        const existingAttendance = await tx.query.attendance.findFirst({
          where: and(eq(attendance.employeeId, employeeId), eq(attendance.date, date))
        });
        
        await invalidateDeviceAttendanceChanges(tx, employeeId, [date]);
        const employee = employeesList.find(row => row.id === employeeId);
        if (!employee) throw new Error("Employee not found");
        if (status === "leave") {
          assertWorkingLeaveDate(date, employee.restDays, existingAttendance?.status);
        }
        if (existingAttendance?.leaveType === "compensatory") {
          await adjustCompensatoryReservation(tx, employeeId, existingAttendance.compensatoryHoursUsed, "0");
        }
        
        await tx
          .insert(attendance)
          .values({
            employeeId,
            date,
            ...payload,
          })
          .onConflictDoUpdate({
            target: [attendance.employeeId, attendance.date],
            set: payload,
          });
      }
    });

    return {
      success: true,
      updated: employeeIds.length,
      inserted: 0,
    };
  });
