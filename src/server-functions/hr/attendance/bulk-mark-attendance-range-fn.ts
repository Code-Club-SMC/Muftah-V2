import { createServerFn } from "@tanstack/react-start";
import { and, between, eq, gte, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  employees,
} from "@/db/schemas/hr-schema";
import { orderBookers, orderBookerTrips } from "@/db/schemas/sales-erp-schema";
import {
  addDays,
  bulkResultMessage,
  countDays,
  datesBetween,
  isRealDate,
  MAX_BULK_DAYS,
  planBulkAttendance,
} from "@/lib/attendance/bulk-mark";
import { adjustCompensatoryReservation } from "@/lib/attendance/compensatory-reservation.server";
import {
  assertAttendanceDatesEditable,
  invalidateDeviceAttendanceChanges,
  lockAttendancePayrollWrites,
} from "@/lib/attendance/device-import/payroll.server";
import { isWorkingLeaveDate } from "@/lib/attendance/leave-policy";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";
import { toPKTDate } from "@/lib/attendance/time";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { getBusinessDateRange } from "@/server-functions/sales/order-booker-trip-day-state";
import { lockEmployeePunchWrites } from "./punch-write-lock";

const dateSchema = z.string().refine(isRealDate, "Choose a valid date");

const bulkAttendanceSchema = z
  .object({
    /**
     * Which employees to mark.
     * Empty array = all active employees.
     */
    employeeIds: z.array(z.string()),

    startDate: dateSchema, // YYYY-MM-DD
    endDate: dateSchema, // YYYY-MM-DD

    template: z.object({
      status: z.enum(["present", "absent", "leave", "holiday"]),
      // Compensatory leave spends banked hours, so it is only given one day at a time.
      leaveType: z.enum(["sick", "annual", "special"]).nullable().optional(),
      notes: z
        .string()
        .trim()
        .max(500, "Keep the note under 500 characters")
        .nullable()
        .optional(),
    }),

    /**
     * skip    — leave existing records completely untouched
     * overwrite — replace existing records that have no punches or field work
     */
    conflictStrategy: z.enum(["skip", "overwrite"]).default("skip"),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  })
  .refine((data) => countDays(data.startDate, data.endDate) <= MAX_BULK_DAYS, {
    message: `Choose at most ${MAX_BULK_DAYS} days at a time`,
    path: ["endDate"],
  })
  .refine(
    (data) => data.template.status !== "leave" || !!data.template.leaveType,
    {
      message: "Leave type is required when status is leave",
      path: ["template", "leaveType"],
    },
  );

type BulkInput = z.infer<typeof bulkAttendanceSchema>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

async function resolveEmployees(executor: Executor, requestedIds: string[]) {
  const ids = [...new Set(requestedIds)];
  const list = await executor.query.employees.findMany({
    where: ids.length
      ? and(inArray(employees.id, ids), eq(employees.status, "active"))
      : eq(employees.status, "active"),
  });
  if (list.length === 0 && !ids.length) throw new Error("No employees found.");
  if (ids.length && list.length !== ids.length)
    throw new Error(
      "Some selected employees are no longer active. Reload the page and select again.",
    );
  return list;
}

async function loadPlan(
  executor: Executor,
  data: BulkInput,
  employeeList: Awaited<ReturnType<typeof resolveEmployees>>,
) {
  const { startDate, endDate, template, conflictStrategy } = data;
  const ids = employeeList.map((employee) => employee.id);
  const bookerIds = employeeList.flatMap((employee) =>
    employee.isOrderBooker ? [employee.id] : [],
  );

  const records = await executor
    .select()
    .from(attendance)
    .where(
      and(
        inArray(attendance.employeeId, ids),
        between(attendance.date, startDate, endDate),
      ),
    );
  // Include neighbouring nights, whose punches can fall inside these shifts.
  const punches = await executor
    .select({
      employeeId: attendancePunches.employeeId,
      attendanceDate: attendancePunches.attendanceDate,
      timestamp: attendancePunches.timestamp,
    })
    .from(attendancePunches)
    .where(
      and(
        inArray(attendancePunches.employeeId, ids),
        or(
          between(attendancePunches.attendanceDate, startDate, endDate),
          between(
            attendancePunches.timestamp,
            new Date(`${addDays(startDate, -1)}T00:00:00+05:00`),
            new Date(`${addDays(endDate, 2)}T00:00:00+05:00`),
          ),
        ),
      ),
    );
  const trips = bookerIds.length
    ? await executor
        .select({
          employeeId: orderBookers.employeeId,
          tripDate: orderBookerTrips.tripDate,
        })
        .from(orderBookerTrips)
        .innerJoin(
          orderBookers,
          eq(orderBookerTrips.orderBookerId, orderBookers.id),
        )
        .where(
          and(
            inArray(orderBookers.employeeId, bookerIds),
            gte(
              orderBookerTrips.tripDate,
              getBusinessDateRange(startDate).start,
            ),
            lt(
              orderBookerTrips.tripDate,
              getBusinessDateRange(endDate).endExclusive,
            ),
          ),
        )
    : [];

  return planBulkAttendance({
    status: template.status,
    conflictStrategy,
    dates: datesBetween(startDate, endDate),
    employees: employeeList,
    records,
    punches,
    tripDays: new Set(
      trips.map((trip) => `${trip.employeeId}:${toPKTDate(trip.tripDate)}`),
    ),
    now: new Date(),
  });
}

// The balance shown on the attendance log counts approved annual days.
async function refreshAnnualLeaveBalance(
  tx: Tx,
  employee: typeof employees.$inferSelect,
) {
  const year = employee.leaveYearStart?.slice(0, 4);
  if (!year) return;
  const approved = await tx.query.attendance.findMany({
    where: and(
      eq(attendance.employeeId, employee.id),
      eq(attendance.status, "leave"),
      eq(attendance.leaveType, "annual"),
      eq(attendance.isApprovedLeave, true),
      between(attendance.date, `${year}-01-01`, `${year}-12-31`),
    ),
    columns: { date: true },
  });
  const used = approved.filter((row) =>
    isWorkingLeaveDate(row.date, employee.restDays),
  ).length;
  await tx
    .update(employees)
    .set({
      annualLeaveBalance: Math.max(
        0,
        (employee.annualLeaveAllowance ?? 14) - used,
      ),
    })
    .where(eq(employees.id, employee.id));
}

export const bulkMarkAttendanceRangeFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(bulkAttendanceSchema)
  .handler(async ({ data, context }) => {
    const { template } = data;
    const actorId = context.session.user.id;
    const notes = template.notes || null;

    return await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      const employeeList = await resolveEmployees(tx, data.employeeIds);
      for (const id of employeeList.map((employee) => employee.id).sort()) {
        await lockEmployeePunchWrites(tx, id);
      }
      // Read after locking: a concurrent upload may have added punches.
      const { writes, summary, noteNeeded } = await loadPlan(
        tx,
        data,
        employeeList,
      );
      if (noteNeeded && !notes)
        throw new Error(
          "Add a note. It is required when marking order bookers, salesmen or drivers.",
        );

      const datesByEmployee = new Map<string, string[]>();
      for (const write of writes) {
        const dates = datesByEmployee.get(write.employee.id) ?? [];
        dates.push(write.date);
        datesByEmployee.set(write.employee.id, dates);
      }
      for (const [employeeId, dates] of datesByEmployee) {
        await invalidateDeviceAttendanceChanges(tx, employeeId, dates);
      }

      const presentPunchRows: (typeof attendancePunches.$inferInsert)[] = [];
      const toInsert: (typeof attendance.$inferInsert)[] = [];
      const balanceChanged = new Set<typeof employees.$inferSelect>();

      for (const { employee, date, existing, punches, dutyHours } of writes) {
        if (
          existing?.status === "leave" &&
          existing.leaveType === "annual" &&
          existing.isApprovedLeave
        )
          balanceChanged.add(employee);

        if (punches) {
          presentPunchRows.push(
            ...punches.map((punch) => ({
              ...punch,
              employeeId: employee.id,
              attendanceDate: date,
              source: "manual" as const,
              terminalUserId: actorId,
              note: null,
            })),
          );
          continue;
        }

        if (existing && Number(existing.compensatoryHoursUsed || "0") > 0) {
          await adjustCompensatoryReservation(
            tx,
            employee.id,
            existing.compensatoryHoursUsed,
            "0",
            {
              kind: existing.status === "leave" ? "comp_leave" : "bank_cover",
              attendanceId: existing.id,
              attendanceDate: date,
              note: "Bulk attendance marking",
              actorId,
            },
          );
        }
        const isLeave = template.status === "leave";
        const row = {
          status: template.status,
          checkIn: null,
          checkOut: null,
          dutyHours,
          overtimeHours: "0.00",
          overtimeStatus: "pending",
          overtimeRemarks: null,
          leaveType: isLeave ? (template.leaveType ?? null) : null,
          leaveApprovalStatus: isLeave ? "pending" : "none",
          isApprovedLeave: false,
          compensatoryHoursUsed: "0",
          isLate: false,
          isNightShift: false,
          earlyDepartureStatus: "none",
          checkOutReason: null,
          shiftViolations: [],
          entrySource: "manual",
          notes,
          updatedAt: new Date(),
        };
        if (existing)
          await tx
            .update(attendance)
            .set(row)
            .where(eq(attendance.id, existing.id));
        else toInsert.push({ employeeId: employee.id, date, ...row });
      }

      // Chunked to stay under the database's parameter limit.
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const chunk = toInsert.slice(i, i + BATCH);
        const added = await tx
          .insert(attendance)
          .values(chunk)
          .onConflictDoNothing()
          .returning({ id: attendance.id });
        // A trip or delivery can save the day first. That record is kept.
        summary.created -= chunk.length - added.length;
        summary.skippedPunchDays += chunk.length - added.length;
      }
      for (let i = 0; i < presentPunchRows.length; i += BATCH) {
        await tx
          .insert(attendancePunches)
          .values(presentPunchRows.slice(i, i + BATCH));
      }
      for (const write of writes) {
        if (!write.punches) continue;
        await recomputeAttendanceRow(tx, write.employee.id, write.date, {
          manualFieldStrategy: "reset",
          noteOverride: notes,
        });
      }
      for (const employee of balanceChanged) {
        await refreshAnnualLeaveBalance(tx, employee);
      }

      return { success: true, summary, message: bulkResultMessage(summary) };
    });
  });

// ── Preview (no writes) ────────────────────────────────────────────────────
// Uses the same plan as the save, so it shows exactly what will happen.

export const previewBulkAttendanceFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(bulkAttendanceSchema)
  .handler(async ({ data }) => {
    const employeeList = await resolveEmployees(db, data.employeeIds);
    const { writes, summary, noteNeeded } = await loadPlan(
      db,
      data,
      employeeList,
    );
    const { created, updated, ...skipped } = summary;

    let blockedReason: string | null = null;
    try {
      await assertAttendanceDatesEditable(
        db,
        [...new Set(writes.map((write) => write.date))],
      );
    } catch (error) {
      blockedReason =
        error instanceof Error ? error.message : "These days are locked.";
    }

    return {
      totalEmployees: employeeList.length,
      affectedEmployees: new Set(writes.map((write) => write.employee.id)).size,
      willCreate: created,
      willUpdate: updated,
      ...skipped,
      noteNeeded,
      blockedReason,
    };
  });
