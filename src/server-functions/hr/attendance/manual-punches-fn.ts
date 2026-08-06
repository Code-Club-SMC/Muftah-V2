import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendancePunchCorrectionAudit } from "@/db/schemas/offline-attendance-schema";
import { attendancePunches, employees } from "@/db/schemas/hr-schema";
import {
  canDeletePunch,
  resolveInsertDirection,
} from "@/lib/attendance/punch-sequence";
import {
  recomputeAttendanceRow,
  type RecomputedAttendanceRow,
} from "@/lib/attendance/recompute-server";
import { toPKTDate } from "@/lib/attendance/time";
import {
  requireHrManageMiddleware,
  requireHrViewMiddleware,
} from "@/lib/middlewares";
import {
  listPunchesForDate,
  lockEmployeePunchWrites,
} from "./punch-write-lock";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const timestampSchema = z.string().refine(
  (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime());
  },
  { message: "Timestamp must be a valid date/time" },
);

const punchResultSchema = z.object({
  employeeId: z.string().min(1),
  timestamp: timestampSchema,
  attendanceDate: dateSchema.optional(),
  direction: z.enum(["in", "out"]).optional(),
  note: z.string().max(500).nullable().optional(),
});
const correctionReasonSchema = z.string().trim().min(5).max(500);

function parseTimestamp(value: string) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Invalid timestamp");
  }
  return timestamp;
}

function punchAuditSnapshot(punch: typeof attendancePunches.$inferSelect) {
  return {
    timestamp: punch.timestamp.toISOString(),
    attendanceDate: punch.attendanceDate,
    direction: punch.direction,
    source: punch.source,
    note: punch.note,
    terminalUserId: punch.terminalUserId,
    offlineImportRowId: punch.offlineImportRowId,
    offlineImportIdentity: punch.offlineImportIdentity,
  };
}

function requireOfflineCorrectionReason(
  punch: typeof attendancePunches.$inferSelect,
  reason: string | undefined,
) {
  if (punch.source !== "offline_excel") {
    return reason?.trim() || null;
  }

  return correctionReasonSchema.parse(reason);
}

async function requireEmployee(employeeId: string) {
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  return employee;
}

export const getEmployeePunchesFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(
    z.object({
      employeeId: z.string().min(1),
      date: dateSchema,
    }),
  )
  .handler(async ({ data }) => {
    return await db.query.attendancePunches.findMany({
      where: and(
        eq(attendancePunches.employeeId, data.employeeId),
        eq(attendancePunches.attendanceDate, data.date),
      ),
      with: {
        terminalUser: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: (table, { asc }) => [asc(table.timestamp)],
    });
  });

export const addManualPunchFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(punchResultSchema)
  .handler(async ({ data, context }) => {
    await requireEmployee(data.employeeId);

    const timestamp = parseTimestamp(data.timestamp);
    const attendanceDate = data.attendanceDate ?? toPKTDate(timestamp);
    const terminalUserId = context.session.user.id;

    return await db.transaction(async (tx) => {
      await lockEmployeePunchWrites(tx, data.employeeId);

      const punchesForDate = await listPunchesForDate(
        tx,
        data.employeeId,
        attendanceDate,
      );
      const direction = resolveInsertDirection(
        punchesForDate,
        timestamp,
        data.direction,
      );

      if (!direction) {
        throw new Error(
          "This punch breaks the IN/OUT order. Correct the existing punches first.",
        );
      }

      const [punch] = await tx
        .insert(attendancePunches)
        .values({
          employeeId: data.employeeId,
          timestamp,
          attendanceDate,
          direction,
          source: "manual",
          terminalUserId,
          note: data.note ?? null,
        })
        .returning();

      if (!punch) {
        throw new Error("Failed to create punch");
      }

      const attendanceRow = await recomputeAttendanceRow(
        tx,
        data.employeeId,
        attendanceDate,
      );

      return {
        punch,
        attendance: attendanceRow,
      };
    });
  });

export const deletePunchFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      punchId: z.string().min(1),
      reason: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{
    deletedPunchId: string;
    attendance: RecomputedAttendanceRow;
  }> => {
    return await db.transaction(async (tx) => {
      const punch = await tx.query.attendancePunches.findFirst({
        where: eq(attendancePunches.id, data.punchId),
      });

      if (!punch) {
        throw new Error("Punch not found");
      }

      await lockEmployeePunchWrites(tx, punch.employeeId);

      const punchesForDate = await listPunchesForDate(
        tx,
        punch.employeeId,
        punch.attendanceDate,
      );
      const canDelete = canDeletePunch(punchesForDate, data.punchId);

      if (!canDelete) {
        throw new Error(
          "Later punches depend on this one. Delete the latest punch first or correct the times instead.",
        );
      }

      const correctionReason = requireOfflineCorrectionReason(punch, data.reason);
      if (correctionReason) {
        await tx.insert(attendancePunchCorrectionAudit).values({
          originalPunchId: punch.id,
          originalImportRowId: punch.offlineImportRowId,
          action: "delete",
          oldValues: punchAuditSnapshot(punch),
          newValues: null,
          reason: correctionReason,
          changedByUserId: context.session.user.id,
        });
      }

      await tx
        .delete(attendancePunches)
        .where(eq(attendancePunches.id, data.punchId));

      const attendanceRow = await recomputeAttendanceRow(
        tx,
        punch.employeeId,
        punch.attendanceDate,
      );

      return {
        deletedPunchId: data.punchId,
        attendance: attendanceRow,
      };
    });
  });

export const correctPunchFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      punchId: z.string().min(1),
      newTimestamp: timestampSchema,
      attendanceDate: dateSchema.optional(),
      note: z.string().max(500).nullable().optional(),
      reason: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{
    punch: typeof attendancePunches.$inferSelect;
    attendance: RecomputedAttendanceRow;
    previousAttendance: RecomputedAttendanceRow | null;
  }> => {
    const newTimestamp = parseTimestamp(data.newTimestamp);
    const newAttendanceDate = data.attendanceDate ?? toPKTDate(newTimestamp);
    const terminalUserId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const existingPunch = await tx.query.attendancePunches.findFirst({
        where: eq(attendancePunches.id, data.punchId),
      });

      if (!existingPunch) {
        throw new Error("Punch not found");
      }

      await lockEmployeePunchWrites(tx, existingPunch.employeeId);

      const currentDayPunches =
        existingPunch.attendanceDate === newAttendanceDate
          ? []
          : await listPunchesForDate(
              tx,
              existingPunch.employeeId,
              existingPunch.attendanceDate,
            );

      if (
        existingPunch.attendanceDate !== newAttendanceDate &&
        currentDayPunches.length > 0 &&
        !canDeletePunch(currentDayPunches, existingPunch.id)
      ) {
        throw new Error(
          "This punch cannot move yet because later punches still depend on it.",
        );
      }

      const nextDayPunches = await listPunchesForDate(
        tx,
        existingPunch.employeeId,
        newAttendanceDate,
        existingPunch.attendanceDate === newAttendanceDate
          ? existingPunch.id
          : undefined,
      );
      const correctedDirection = resolveInsertDirection(
        nextDayPunches,
        newTimestamp,
        existingPunch.direction,
      );

      if (!correctedDirection) {
        throw new Error(
          "This corrected time breaks the IN/OUT order for that day.",
        );
      }

      const correctionReason = requireOfflineCorrectionReason(
        existingPunch,
        data.reason,
      );

      await tx
        .delete(attendancePunches)
        .where(eq(attendancePunches.id, existingPunch.id));

      const [newPunch] = await tx
        .insert(attendancePunches)
        .values({
          employeeId: existingPunch.employeeId,
          timestamp: newTimestamp,
          attendanceDate: newAttendanceDate,
          direction: correctedDirection,
          source: "manual",
          terminalUserId,
          note: data.note ?? existingPunch.note,
        })
        .returning();

      if (!newPunch) {
        throw new Error("Failed to correct punch");
      }

      if (correctionReason) {
        await tx.insert(attendancePunchCorrectionAudit).values({
          originalPunchId: existingPunch.id,
          originalImportRowId: existingPunch.offlineImportRowId,
          action: "correct",
          oldValues: punchAuditSnapshot(existingPunch),
          newValues: punchAuditSnapshot(newPunch),
          reason: correctionReason,
          changedByUserId: context.session.user.id,
        });
      }

      const previousAttendance =
        existingPunch.attendanceDate === newAttendanceDate
          ? null
          : await recomputeAttendanceRow(
              tx,
              existingPunch.employeeId,
              existingPunch.attendanceDate,
            );

      const attendanceRow = await recomputeAttendanceRow(
        tx,
        existingPunch.employeeId,
        newAttendanceDate,
      );

      return {
        punch: newPunch,
        attendance: attendanceRow,
        previousAttendance,
      };
    });
  });
