import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendance,
  compensatoryCashOuts,
  employees,
} from "@/db/schemas/hr-schema";
import { requireHrManageMiddleware, requireHrViewMiddleware } from "@/lib/middlewares";
import {
  invalidateDeviceAttendanceChanges,
  lockAttendancePayrollWrites,
} from "@/lib/attendance/device-import/payroll.server";
import { adjustCompensatoryReservation } from "@/lib/attendance/compensatory-reservation.server";
import { getOvertimeStandardDutyHours } from "@/lib/attendance/overtime-request";
import { maxCoverHours } from "@/lib/attendance/compensatory-bank";
import { nowPKTDate } from "@/lib/attendance/time";
import { lockEmployeePunchWrites } from "./punch-write-lock";

const hoursSchema = z
  .number()
  .finite()
  .min(0)
  .max(999)
  .transform((value) => Math.round(value * 100) / 100);

/**
 * Spend banked hours on a short present day (undertime or lateness).
 * Payroll adds the covered hours to the day's worked hours. Passing 0 removes the cover.
 */
export const applyCompensatoryCoverFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ attendanceId: z.string().min(1), hours: hoursSchema }))
  .handler(async ({ data }) =>
    db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      const row = await tx.query.attendance.findFirst({
        where: eq(attendance.id, data.attendanceId),
      });
      if (!row) throw new Error("Attendance record not found.");
      await lockEmployeePunchWrites(tx, row.employeeId);
      const employee = await tx.query.employees.findFirst({
        where: eq(employees.id, row.employeeId),
      });
      if (!employee) throw new Error("Employee not found.");
      if (employee.isSalesman || employee.isDriver || employee.isOrderBooker)
        throw new Error("Banked hours can only cover standard punch attendance.");
      if (row.status !== "present")
        throw new Error("Banked hours can only cover a present day that is short.");

      const currentCover = Number(row.compensatoryHoursUsed || "0");
      const limit = maxCoverHours({
        standardHours: getOvertimeStandardDutyHours(row.date, employee),
        dutyHours: Number(row.dutyHours || "0"),
        balance: Number(employee.compensatoryHoursBalance || "0"),
        currentCover,
      });
      if (data.hours > limit + 0.001)
        throw new Error(`Only ${limit}h can be applied to this day.`);

      await invalidateDeviceAttendanceChanges(tx, row.employeeId, [row.date]);
      await adjustCompensatoryReservation(
        tx,
        row.employeeId,
        row.compensatoryHoursUsed,
        data.hours.toFixed(2),
      );
      const [updated] = await tx
        .update(attendance)
        .set({ compensatoryHoursUsed: data.hours.toFixed(2), updatedAt: new Date() })
        .where(eq(attendance.id, row.id))
        .returning();
      return updated;
    }),
  );

export const listCompensatoryCashOutsFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ employeeId: z.string().min(1) }))
  .handler(async ({ data }) =>
    db.query.compensatoryCashOuts.findMany({
      where: eq(compensatoryCashOuts.employeeId, data.employeeId),
      orderBy: desc(compensatoryCashOuts.createdAt),
      with: {
        payslip: {
          columns: { id: true },
          with: { payroll: { columns: { month: true, status: true } } },
        },
      },
    }),
  );

/**
 * Take banked hours out of the balance now; the next generated payslip pays them.
 * Final settlement always takes the whole remaining balance.
 */
export const createCompensatoryCashOutFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      employeeId: z.string().min(1),
      kind: z.enum(["cash_out", "final_settlement"]),
      hours: hoursSchema.optional(),
      notes: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) =>
    db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      await lockEmployeePunchWrites(tx, data.employeeId);
      const employee = await tx.query.employees.findFirst({
        where: eq(employees.id, data.employeeId),
        columns: { compensatoryHoursBalance: true },
      });
      if (!employee) throw new Error("Employee not found.");
      const balance = Number(employee.compensatoryHoursBalance || "0");
      const hours =
        data.kind === "final_settlement" ? balance : (data.hours ?? 0);
      if (hours <= 0)
        throw new Error(
          data.kind === "final_settlement"
            ? "There are no banked hours to settle."
            : "Enter the hours to cash out.",
        );

      await adjustCompensatoryReservation(tx, data.employeeId, "0", hours.toFixed(2));
      const [created] = await tx
        .insert(compensatoryCashOuts)
        .values({
          employeeId: data.employeeId,
          hours: hours.toFixed(2),
          kind: data.kind,
          requestedDate: nowPKTDate(),
          notes: data.notes || null,
          createdBy: context.session.user.id,
        })
        .returning();
      return created;
    }),
  );

/** Only cash-outs not yet in a payslip can be cancelled; the hours return to the bank. */
export const cancelCompensatoryCashOutFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) =>
    db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      const cashOut = await tx.query.compensatoryCashOuts.findFirst({
        where: eq(compensatoryCashOuts.id, data.id),
      });
      if (!cashOut) throw new Error("Cash-out not found.");
      await lockEmployeePunchWrites(tx, cashOut.employeeId);
      const [cancelled] = await tx
        .update(compensatoryCashOuts)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(compensatoryCashOuts.id, data.id),
            eq(compensatoryCashOuts.status, "pending"),
            isNull(compensatoryCashOuts.paidInPayslipId),
          ),
        )
        .returning();
      if (!cancelled)
        throw new Error(
          "This cash-out is already in a payslip. Regenerate or delete that payslip first.",
        );
      await adjustCompensatoryReservation(tx, cashOut.employeeId, cashOut.hours, "0");
      return cancelled;
    }),
  );
