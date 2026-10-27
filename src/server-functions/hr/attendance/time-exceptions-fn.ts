import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, inArray, lte, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendance, attendanceTimeExceptions, employees } from "@/db/schemas/hr-schema";
import { user } from "@/db/schemas/auth-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import {
  assertAttendanceDatesEditable,
  invalidateDeviceAttendanceChanges,
  lockAttendancePayrollWrites,
} from "@/lib/attendance/device-import/payroll.server";
import {
  TIME_EXCEPTION_DECISIONS,
  validateTimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";
import { lockEmployeePunchWrites } from "./punch-write-lock";

export const getTimeExceptionsFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      view: z.enum(["pending", "decided", "all"]).default("pending"),
      from: z.string().optional(),
      to: z.string().optional(),
      attendanceId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const filters: SQL[] = [eq(attendance.status, "present")];
    if (data.view === "pending") filters.push(eq(attendanceTimeExceptions.status, "pending"));
    if (data.view === "decided") {
      filters.push(
        inArray(attendanceTimeExceptions.status, ["approved_official", "approved_excused", "rejected"]),
      );
    }
    // Grace rows are display-only; the approvals list hides them unless one row is requested.
    if (data.attendanceId) {
      filters.push(eq(attendanceTimeExceptions.attendanceId, data.attendanceId));
    } else {
      filters.push(ne(attendanceTimeExceptions.status, "grace"));
    }
    if (data.from) filters.push(gte(attendanceTimeExceptions.date, data.from));
    if (data.to) filters.push(lte(attendanceTimeExceptions.date, data.to));

    const rows = await db
      .select({
        id: attendanceTimeExceptions.id,
        attendanceId: attendanceTimeExceptions.attendanceId,
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        department: employees.department,
        date: attendanceTimeExceptions.date,
        shiftIndex: attendanceTimeExceptions.shiftIndex,
        kind: attendanceTimeExceptions.kind,
        minutes: attendanceTimeExceptions.minutes,
        status: attendanceTimeExceptions.status,
        note: attendanceTimeExceptions.note,
        decidedByName: user.name,
        decidedAt: attendanceTimeExceptions.decidedAt,
        shiftViolations: attendance.shiftViolations,
      })
      .from(attendanceTimeExceptions)
      .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
      .innerJoin(employees, eq(attendanceTimeExceptions.employeeId, employees.id))
      .leftJoin(user, eq(attendanceTimeExceptions.decidedBy, user.id))
      .where(and(...filters))
      .orderBy(
        desc(attendanceTimeExceptions.date),
        employees.firstName,
        attendanceTimeExceptions.shiftIndex,
        attendanceTimeExceptions.kind,
      );

    const items = rows.map(({ firstName, lastName, shiftViolations, ...row }) => {
      const shift = shiftViolations?.find((v) => v.shiftIndex === row.shiftIndex);
      return {
        ...row,
        employeeName: `${firstName} ${lastName ?? ""}`.trim(),
        expectedTime: (row.kind === "late" ? shift?.expectedIn : shift?.expectedOut) ?? null,
        actualTime: (row.kind === "late" ? shift?.actualIn : shift?.actualOut) ?? null,
      };
    });

    const pending = await db
      .select({ id: attendanceTimeExceptions.id })
      .from(attendanceTimeExceptions)
      .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
      .where(and(eq(attendanceTimeExceptions.status, "pending"), eq(attendance.status, "present")));

    return { items, pendingCount: pending.length };
  });

export type TimeExceptionListItem = Awaited<ReturnType<typeof getTimeExceptionsFn>>["items"][number];

export const decideTimeExceptionsFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      ids: z.array(z.string()).min(1).max(500),
      status: z.enum(TIME_EXCEPTION_DECISIONS),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const deciderId = context.authContext.session.user.id;
    return await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      const rows = await tx.query.attendanceTimeExceptions.findMany({
        where: inArray(attendanceTimeExceptions.id, data.ids),
      });
      if (rows.length !== new Set(data.ids).size) {
        throw new Error("Some late/early items no longer exist. Refresh and try again.");
      }
      for (const row of rows) {
        validateTimeExceptionDecision({ currentStatus: row.status, nextStatus: data.status, note: data.note });
      }

      await assertAttendanceDatesEditable(tx, [...new Set(rows.map((row) => row.date))]);

      const datesByEmployee = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!datesByEmployee.has(row.employeeId)) datesByEmployee.set(row.employeeId, new Set());
        datesByEmployee.get(row.employeeId)!.add(row.date);
      }
      // Sorted so two concurrent bulk decisions take employee locks in the same order.
      for (const employeeId of [...datesByEmployee.keys()].sort()) {
        await lockEmployeePunchWrites(tx, employeeId);
        await invalidateDeviceAttendanceChanges(tx, employeeId, [...datesByEmployee.get(employeeId)!]);
      }

      const now = new Date();
      const note = data.note || null;
      const decided = data.status !== "pending";
      for (const row of rows) {
        await tx
          .update(attendanceTimeExceptions)
          .set({
            status: data.status,
            note,
            decidedBy: decided ? deciderId : null,
            decidedAt: decided ? now : null,
            history: [
              ...row.history,
              { status: data.status, note, decidedBy: deciderId, decidedAt: now.toISOString() },
            ],
            updatedAt: now,
          })
          .where(eq(attendanceTimeExceptions.id, row.id));
      }

      return { updated: rows.length };
    });
  });
