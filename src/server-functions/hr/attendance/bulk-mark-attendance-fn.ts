import { eq, and } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
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
      for (const employeeId of employeeIds) {
        const payload = buildNormalizedAttendancePayload(employeeId);
        
        // Handle potential compensatory balance refund
        const existingAttendance = await tx.query.attendance.findFirst({
          where: and(eq(attendance.employeeId, employeeId), eq(attendance.date, date))
        });
        
        if (existingAttendance?.leaveType === "compensatory") {
          const previousCompUsed = parseFloat(existingAttendance.compensatoryHoursUsed || "0");
          if (previousCompUsed > 0) {
            const emp = await tx.query.employees.findFirst({
              where: eq(employees.id, employeeId),
              columns: { compensatoryHoursBalance: true }
            });
            if (emp) {
              const currentBalance = parseFloat(emp.compensatoryHoursBalance || "0");
              await tx.update(employees)
                .set({ compensatoryHoursBalance: (currentBalance + previousCompUsed).toString() })
                .where(eq(employees.id, employeeId));
            }
          }
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
