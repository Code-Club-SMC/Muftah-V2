import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance } from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

export const bulkMarkAttendanceFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z
      .object({
        employeeIds: z.array(z.string()),
        date: z.string(),
        status: z.enum(["present", "absent", "leave", "holiday"]),
        leaveType: z.enum(["sick", "annual", "special"]).nullable().optional(),
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
      overtimeRemarks: null,
      overtimeStatus: "pending",
      entrySource: "manual",
      notes: null,
      updatedAt: new Date(),
    });

    for (const employeeId of employeeIds) {
      const payload = buildNormalizedAttendancePayload(employeeId);
      await db
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

    return {
      success: true,
      updated: employeeIds.length,
      inserted: 0,
    };
  });
