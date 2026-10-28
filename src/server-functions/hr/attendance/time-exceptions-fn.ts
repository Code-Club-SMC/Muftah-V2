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
  DECIDED_TIME_EXCEPTION_STATUSES,
  TIME_EXCEPTION_DECISIONS,
  TIME_EXCEPTION_VIEWS,
  validateTimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";
import {
  countOpenPendingTimeExceptions,
  openPendingTimeExceptionFilter,
} from "@/lib/attendance/time-exceptions.server";
import { lockEmployeePunchWrites } from "./punch-write-lock";

/** Decided and all views show the newest rows only; pending items always show in full. */
export const TIME_EXCEPTION_HISTORY_LIMIT = 200;

export const getTimeExceptionsFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      view: z.enum(TIME_EXCEPTION_VIEWS).default("pending"),
      from: z.string().optional(),
      to: z.string().optional(),
      attendanceId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const filters: SQL[] = [eq(attendance.status, "present")];
    // Pending excludes items locked inside approved or paid payroll: nobody can decide those any more.
    if (data.view === "pending") filters.push(openPendingTimeExceptionFilter());
    if (data.view === "decided") {
      filters.push(inArray(attendanceTimeExceptions.status, [...DECIDED_TIME_EXCEPTION_STATUSES]));
    }
    // Grace rows are display-only; the approvals list hides them unless one row is requested.
    if (data.attendanceId) {
      filters.push(eq(attendanceTimeExceptions.attendanceId, data.attendanceId));
    } else {
      filters.push(ne(attendanceTimeExceptions.status, "grace"));
    }
    if (data.from) filters.push(gte(attendanceTimeExceptions.date, data.from));
    if (data.to) filters.push(lte(attendanceTimeExceptions.date, data.to));

    const limited = data.view !== "pending" && !data.attendanceId;
    const query = db
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
    // One extra row tells the screen there is more history than it shows.
    const rows = limited ? await query.limit(TIME_EXCEPTION_HISTORY_LIMIT + 1) : await query;
    const hasMore = limited && rows.length > TIME_EXCEPTION_HISTORY_LIMIT;

    const items = rows.slice(0, limited ? TIME_EXCEPTION_HISTORY_LIMIT : undefined).map(
      ({ firstName, lastName, shiftViolations, ...row }) => {
        const shift = shiftViolations?.find((v) => v.shiftIndex === row.shiftIndex);
        return {
          ...row,
          employeeName: `${firstName} ${lastName ?? ""}`.trim(),
          expectedTime: (row.kind === "late" ? shift?.expectedIn : shift?.expectedOut) ?? null,
          actualTime: (row.kind === "late" ? shift?.actualIn : shift?.actualOut) ?? null,
        };
      },
    );

    const pending = await countOpenPendingTimeExceptions();
    return { items, hasMore, pendingCount: pending.items };
  });

export type TimeExceptionListItem = Awaited<ReturnType<typeof getTimeExceptionsFn>>["items"][number];

const decideTimeExceptionsInput = z.object({
  ids: z.array(z.string()).min(1).max(500),
  status: z.enum(TIME_EXCEPTION_DECISIONS),
  note: z.string().trim().max(500).optional(),
});
export type DecideTimeExceptionsInput = z.infer<typeof decideTimeExceptionsInput>;

export const decideTimeExceptionsFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(decideTimeExceptionsInput)
  .handler(async ({ data, context }) => {
    const deciderId = context.authContext.session.user.id;
    return await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      const where = inArray(attendanceTimeExceptions.id, data.ids);
      const owners = await tx
        .selectDistinct({ employeeId: attendanceTimeExceptions.employeeId })
        .from(attendanceTimeExceptions)
        .where(where);
      // Offline confirmation recomputes under the employee lock only, so read items after taking it.
      // Sorted so two concurrent bulk decisions take employee locks in the same order.
      for (const employeeId of owners.map((o) => o.employeeId).sort()) {
        await lockEmployeePunchWrites(tx, employeeId);
      }
      const rows = await tx.query.attendanceTimeExceptions.findMany({
        where,
        with: { attendance: { columns: { status: true } } },
      });
      if (rows.length !== new Set(data.ids).size) {
        throw new Error("Some late/early items no longer exist. Refresh and try again.");
      }
      for (const row of rows) {
        if (row.attendance.status !== "present") {
          throw new Error(`${row.date} is no longer marked present, so its late/early items need no decision. Refresh and try again.`);
        }
        validateTimeExceptionDecision({ currentStatus: row.status, nextStatus: data.status, note: data.note });
      }

      await assertAttendanceDatesEditable(tx, [...new Set(rows.map((row) => row.date))]);

      const datesByEmployee = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!datesByEmployee.has(row.employeeId)) datesByEmployee.set(row.employeeId, new Set());
        datesByEmployee.get(row.employeeId)!.add(row.date);
      }
      for (const [employeeId, dates] of datesByEmployee) {
        await invalidateDeviceAttendanceChanges(tx, employeeId, [...dates]);
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
