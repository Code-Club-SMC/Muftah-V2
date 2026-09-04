function isRestDay(date: string, restDays: unknown) {
  const configuredRestDays = Array.isArray(restDays)
    ? restDays.filter((day): day is number => Number.isInteger(day))
    : [0];
  const [year, month, day] = date.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return configuredRestDays.includes(dayOfWeek);
}

import { and, asc, eq } from "drizzle-orm";
import {
  attendance,
  attendancePunches,
  employees,
} from "@/db/schemas/hr-schema";
import type { db } from "@/db";
import { revalidateOvertimeRequest } from "./overtime-request";
import { calculateTotalShiftHours } from "./time";
import { computeAttendanceFromPunches } from "./recompute";

export type AttendanceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type RecomputedAttendanceRow = typeof attendance.$inferSelect | null;

type RecomputeAttendanceRowOptions = {
  forceNightShift?: boolean;
  appendNote?: string;
  noteOverride?: string | null;
  manualFieldStrategy?: "preserve" | "reset";
};

const DEFAULT_GRACE_MINUTES = 15;
const NIGHT_SHIFT_START_HOUR = 20;

function resolveEarlyDepartureStatus(
  existingStatus: string | null | undefined,
  computedStatus: "none" | "pending",
): "none" | "pending" | "approved" | "rejected" {
  if (computedStatus === "none") return "none";
  if (existingStatus === "approved" || existingStatus === "rejected") {
    return existingStatus;
  }
  return "pending";
}

function appendUniqueNote(
  existingNote: string | null,
  note?: string,
): string | null {
  if (!note) return existingNote ?? null;
  if (!existingNote) return note;
  if (existingNote.includes(note)) return existingNote;
  return `${existingNote}\n${note}`;
}

function getPunchDrivenSource(
  punches: Array<typeof attendancePunches.$inferSelect>,
) {
  return punches.some((punch) => punch.source === "qr_terminal")
    ? "qr_terminal"
    : "manual";
}

export async function recomputeAttendanceRow(
  tx: AttendanceTx,
  employeeId: string,
  attendanceDate: string,
  options: RecomputeAttendanceRowOptions = {},
): Promise<RecomputedAttendanceRow> {
  const employee = await tx.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  const existingAttendance = await tx.query.attendance.findFirst({
    where: and(
      eq(attendance.employeeId, employeeId),
      eq(attendance.date, attendanceDate),
    ),
  });

  const punches = await tx.query.attendancePunches.findMany({
    where: and(
      eq(attendancePunches.employeeId, employeeId),
      eq(attendancePunches.attendanceDate, attendanceDate),
    ),
    orderBy: [asc(attendancePunches.timestamp)],
  });

  if (punches.length === 0) {
    if (existingAttendance?.status === "present") {
      await tx
        .delete(attendance)
        .where(eq(attendance.id, existingAttendance.id));
      return null;
    }

    return existingAttendance ?? null;
  }

  const computed = computeAttendanceFromPunches(
    punches.map((punch) => ({
      direction: punch.direction,
      timestamp: punch.timestamp,
    })),
    {
      shifts: employee.shifts ?? [],
      graceMinutes: DEFAULT_GRACE_MINUTES,
      nightShiftStartHour: NIGHT_SHIFT_START_HOUR,
      forceNightShift: options.forceNightShift,
    },
  );
  const isOffDay = isRestDay(attendanceDate, employee.restDays);
  const shiftHours = calculateTotalShiftHours(employee.shifts);
  const standardHours = shiftHours > 0 ? shiftHours : (employee.standardDutyHours || 8);
  const effectiveStandardHours = isOffDay ? 0 : standardHours;

  const overtimeRevalidation = revalidateOvertimeRequest({
    dutyHours: computed.dutyHours,
    standardDutyHours: effectiveStandardHours,
    requestedOvertimeHours: existingAttendance?.overtimeHours,
    currentOvertimeStatus: existingAttendance?.overtimeStatus,
  });

  const manualFieldStrategy = options.manualFieldStrategy ?? "preserve";

  const updateData = {
    status: "present" as const,
    checkIn: computed.checkIn,
    checkOut: computed.checkOut,
    dutyHours: computed.dutyHours,
    isLate: computed.isLate ?? existingAttendance?.isLate ?? false,
    isNightShift: computed.isNightShift,
    earlyDepartureStatus:
      manualFieldStrategy === "reset"
        ? computed.earlyDepartureStatus
        : resolveEarlyDepartureStatus(
            existingAttendance?.earlyDepartureStatus,
            computed.earlyDepartureStatus,
          ),
    shiftViolations: computed.shiftViolations,
    entrySource: getPunchDrivenSource(punches),
    notes:
      options.noteOverride !== undefined
        ? options.noteOverride
        : appendUniqueNote(existingAttendance?.notes ?? null, options.appendNote),
    ...(manualFieldStrategy === "reset"
      ? {
          overtimeHours: isOffDay && parseFloat(computed.dutyHours) > 0 ? computed.dutyHours : "0.00",
          overtimeStatus: "pending",
          overtimeRemarks: isOffDay && parseFloat(computed.dutyHours) > 0 ? "Worked on rest day" : null,
          checkOutReason: null,
          isApprovedLeave: false,
          leaveType: null,
          leaveApprovalStatus: "none",
        }
      : existingAttendance
        ? {
            overtimeHours: isOffDay && (!existingAttendance.overtimeHours || parseFloat(existingAttendance.overtimeHours) === 0) && parseFloat(computed.dutyHours) > 0
              ? computed.dutyHours
              : existingAttendance.overtimeHours ?? "0.00",
            overtimeStatus: overtimeRevalidation.nextOvertimeStatus,
            overtimeRemarks: existingAttendance.overtimeRemarks ?? (isOffDay && parseFloat(computed.dutyHours) > 0 ? "Worked on rest day" : null),
          }
        : {
            overtimeHours: isOffDay && parseFloat(computed.dutyHours) > 0 ? computed.dutyHours : "0.00",
            overtimeStatus: "pending",
            overtimeRemarks: isOffDay && parseFloat(computed.dutyHours) > 0 ? "Worked on rest day" : null,
          }
    ),
    updatedAt: new Date(),
  };

  // Compensatory balance adjustment
  if (existingAttendance?.leaveType === "compensatory") {
      const previousCompUsed = parseFloat(existingAttendance.compensatoryHoursUsed || "0");
      const newCompUsed = (updateData as any).leaveType === "compensatory" ? parseFloat((updateData as any).compensatoryHoursUsed || "0") : 0;
      const compHoursDiff = newCompUsed - previousCompUsed;

      if (compHoursDiff !== 0) {
          const emp = await tx.query.employees.findFirst({
              where: eq(employees.id, employeeId),
              columns: { compensatoryHoursBalance: true }
          });
          if (emp) {
              const currentBalance = parseFloat(emp.compensatoryHoursBalance || "0");
              const newBalance = currentBalance - compHoursDiff;
              await tx.update(employees)
                  .set({ compensatoryHoursBalance: newBalance.toString() })
                  .where(eq(employees.id, employeeId));
          }
      }
  }

  const [upserted] = await tx
    .insert(attendance)
    .values({
      employeeId,
      date: attendanceDate,
      ...updateData,
    })
    .onConflictDoUpdate({
      target: [attendance.employeeId, attendance.date],
      set: updateData,
    })
    .returning();

  return upserted ?? null;
}
