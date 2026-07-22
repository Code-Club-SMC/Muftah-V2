import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  attendanceScanAttempts,
  employees,
} from "@/db/schemas/hr-schema";
import { resolveAttendanceDate } from "@/lib/attendance/back-attribute";
import { parseQrPayload } from "@/lib/attendance/payload";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";
import { toPKTTime } from "@/lib/attendance/time";
import { requireAttendanceTerminalMiddleware } from "@/lib/middlewares";
import { lockEmployeePunchWrites } from "./punch-write-lock";

const DUPLICATE_SCAN_WINDOW_MS = 30_000;
const OVERNIGHT_OUT_BEFORE_HOUR = 12;
const REST_DAY_NOTE = "Scanned on rest day";

type ScanRejectedReason =
  | "invalid_payload"
  | "unknown_employee"
  | "inactive"
  | "on_leave"
  | "on_holiday"
  | "marked_absent"
  | "duplicate_scan";

type ScanResult =
  | {
      status: "accepted";
      direction: "in" | "out";
      employeeName: string;
      employeeCode: string;
      attendanceDate: string;
      punchTime: string;
      isLate: boolean | null;
      dutyHours: string;
      isNightShift: boolean;
      message: string;
    }
  | {
      status: "rejected";
      reason: Exclude<ScanRejectedReason, "duplicate_scan">;
      message: string;
      employeeName?: string;
      employeeCode?: string;
    }
  | {
      status: "duplicate";
      reason: "duplicate_scan";
      message: string;
      employeeName: string;
      employeeCode: string;
    };

function employeeName(employee: {
  firstName: string;
  lastName: string;
}) {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

function getDateDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isRestDay(date: string, restDays: unknown) {
  const configuredRestDays = Array.isArray(restDays)
    ? restDays.filter((day): day is number => Number.isInteger(day))
    : [0];
  return configuredRestDays.includes(getDateDay(date));
}

async function logRejectedScan(params: {
  employeeId?: string | null;
  payload: string;
  reason: ScanRejectedReason;
  message: string;
  terminalUserId: string;
  timestamp: Date;
}) {
  await db.insert(attendanceScanAttempts).values({
    employeeId: params.employeeId ?? null,
    payload: params.payload,
    reason: params.reason,
    message: params.message,
    terminalUserId: params.terminalUserId,
    timestamp: params.timestamp,
  });
}

function rejected(
  reason: Exclude<ScanRejectedReason, "duplicate_scan">,
  message: string,
  employee?: {
    firstName: string;
    lastName: string;
    employeeCode: string;
  },
): ScanResult {
  return {
    status: "rejected",
    reason,
    message,
    employeeName: employee ? employeeName(employee) : undefined,
    employeeCode: employee?.employeeCode,
  };
}

export const scanAttendanceFn = createServerFn()
  .middleware([requireAttendanceTerminalMiddleware])
  .inputValidator(
    z.object({
      rawPayload: z.string().min(1).max(4096),
    }),
  )
  .handler(async ({ data, context }): Promise<ScanResult> => {
    const now = new Date();
    const terminalUserId = context.session.user.id;
    const parsedPayload = parseQrPayload(data.rawPayload);

    if (!parsedPayload.ok) {
      const message = "Invalid card";
      await logRejectedScan({
        payload: data.rawPayload,
        reason: "invalid_payload",
        message,
        terminalUserId,
        timestamp: now,
      });
      return rejected("invalid_payload", message);
    }

    const employee = await db.query.employees.findFirst({
      where: parsedPayload.employeeId
        ? eq(employees.id, parsedPayload.employeeId)
        : eq(employees.employeeCode, parsedPayload.employeeCode),
    });

    if (!employee || employee.employeeCode !== parsedPayload.employeeCode) {
      const message = "Unknown employee";
      await logRejectedScan({
        employeeId: employee?.id ?? null,
        payload: data.rawPayload,
        reason: "unknown_employee",
        message,
        terminalUserId,
        timestamp: now,
      });
      return rejected("unknown_employee", message);
    }

    if (employee.status !== "active") {
      const message = "Employee inactive - see HR";
      await logRejectedScan({
        employeeId: employee.id,
        payload: data.rawPayload,
        reason: "inactive",
        message,
        terminalUserId,
        timestamp: now,
      });
      return rejected("inactive", message, employee);
    }

    return await db.transaction(async (tx): Promise<ScanResult> => {
      await lockEmployeePunchWrites(tx, employee.id);

      const [lastPunch] = await tx
        .select()
        .from(attendancePunches)
        .where(eq(attendancePunches.employeeId, employee.id))
        .orderBy(desc(attendancePunches.timestamp))
        .limit(1);

      if (
        lastPunch &&
        now.getTime() - lastPunch.timestamp.getTime() < DUPLICATE_SCAN_WINDOW_MS
      ) {
        const message = "Duplicate scan - wait a moment";
        await tx.insert(attendanceScanAttempts).values({
          employeeId: employee.id,
          payload: data.rawPayload,
          reason: "duplicate_scan",
          message,
          terminalUserId,
          timestamp: now,
        });
        return {
          status: "duplicate",
          reason: "duplicate_scan",
          message,
          employeeName: employeeName(employee),
          employeeCode: employee.employeeCode,
        };
      }

      const resolved = resolveAttendanceDate(
        now,
        lastPunch
          ? {
              direction: lastPunch.direction,
              attendanceDate: lastPunch.attendanceDate,
              timestamp: lastPunch.timestamp.toISOString(),
            }
          : null,
        { overnightOutBeforeHour: OVERNIGHT_OUT_BEFORE_HOUR },
      );

      const existingAttendance = await tx.query.attendance.findFirst({
        where: and(
          eq(attendance.employeeId, employee.id),
          eq(attendance.date, resolved.attendanceDate),
        ),
      });

      if (existingAttendance?.status === "leave") {
        const message = "You are on approved leave today - see HR";
        await tx.insert(attendanceScanAttempts).values({
          employeeId: employee.id,
          payload: data.rawPayload,
          reason: "on_leave",
          message,
          terminalUserId,
          timestamp: now,
        });
        return rejected("on_leave", message, employee);
      }

      if (existingAttendance?.status === "holiday") {
        const message = "Today is marked as a holiday - see HR";
        await tx.insert(attendanceScanAttempts).values({
          employeeId: employee.id,
          payload: data.rawPayload,
          reason: "on_holiday",
          message,
          terminalUserId,
          timestamp: now,
        });
        return rejected("on_holiday", message, employee);
      }

      if (existingAttendance?.status === "absent") {
        const message = "Marked absent today - see HR";
        await tx.insert(attendanceScanAttempts).values({
          employeeId: employee.id,
          payload: data.rawPayload,
          reason: "marked_absent",
          message,
          terminalUserId,
          timestamp: now,
        });
        return rejected("marked_absent", message, employee);
      }

      await tx.insert(attendancePunches).values({
        employeeId: employee.id,
        timestamp: now,
        attendanceDate: resolved.attendanceDate,
        direction: resolved.direction,
        source: "qr_terminal",
        terminalUserId,
      });

      const recomputed = await recomputeAttendanceRow(
        tx,
        employee.id,
        resolved.attendanceDate,
        {
          forceNightShift: resolved.isOvernightCheckout,
          appendNote: isRestDay(resolved.attendanceDate, employee.restDays)
            ? REST_DAY_NOTE
            : undefined,
        },
      );

      return {
        status: "accepted",
        direction: resolved.direction,
        employeeName: employeeName(employee),
        employeeCode: employee.employeeCode,
        attendanceDate: resolved.attendanceDate,
        punchTime: toPKTTime(now),
        isLate: recomputed?.isLate ?? null,
        dutyHours: recomputed?.dutyHours ?? "0.00",
        isNightShift: recomputed?.isNightShift ?? false,
        message:
          resolved.direction === "in"
            ? "Checked in successfully"
            : "Checked out successfully",
      };
    });
  });
