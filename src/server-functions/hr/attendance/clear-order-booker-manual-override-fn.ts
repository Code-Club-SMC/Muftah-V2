import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { orderBookers } from "@/db/schemas/sales-erp-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { ORDER_BOOKER_TRIP_ENTRY_SOURCE } from "@/lib/attendance/order-booker-day-state";
import { syncOrderBookerAttendanceForDate } from "@/server-functions/sales/order-booker-trip-sync";

export const clearOrderBookerManualOverrideFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        employeeId: z.string().min(1),
        date: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const employee = await tx.query.employees.findFirst({
        where: eq(employees.id, data.employeeId),
      });

      if (!employee) throw new Error("Employee not found");
      if (!employee.isOrderBooker) {
        throw new Error("Manual override reset is only valid for order bookers.");
      }

      const existingAttendance = await tx.query.attendance.findFirst({
        where: and(
          eq(attendance.employeeId, data.employeeId),
          eq(attendance.date, data.date),
        ),
      });

      if (!existingAttendance) {
        return { success: true, restoredTripDriven: false };
      }

      if (existingAttendance.entrySource === ORDER_BOOKER_TRIP_ENTRY_SOURCE) {
        throw new Error("This day is already trip-driven.");
      }

      const linkedOrderBooker = await tx.query.orderBookers.findFirst({
        where: eq(orderBookers.employeeId, data.employeeId),
        columns: { id: true },
      });

      await tx
        .delete(attendance)
        .where(eq(attendance.id, existingAttendance.id));

      if (!linkedOrderBooker) {
        return { success: true, restoredTripDriven: false };
      }

      await syncOrderBookerAttendanceForDate({
        tx,
        employeeId: employee.id,
        orderBookerId: linkedOrderBooker.id,
        businessDate: data.date,
        standardDutyHours: employee.standardDutyHours ?? 8,
      });

      const restoredAttendance = await tx.query.attendance.findFirst({
        where: and(
          eq(attendance.employeeId, data.employeeId),
          eq(attendance.date, data.date),
        ),
        columns: { entrySource: true },
      });

      return {
        success: true,
        restoredTripDriven:
          restoredAttendance?.entrySource === ORDER_BOOKER_TRIP_ENTRY_SOURCE,
      };
    });
  });
