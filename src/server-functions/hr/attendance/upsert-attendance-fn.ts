import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { attendance, attendancePunches, employees } from "@/db/schemas/hr-schema";
import {
  orderBookers,
  orderBookerTrips,
} from "@/db/schemas/sales-erp-schema";
import {
  buildOvertimeRequestSummary,
  normalizeRequestedOvertimeHours,
} from "@/lib/attendance/overtime-request";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";
import { upsertAttendanceSchema } from "@/lib/validators/hr-validators";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { and, eq, gte, lt } from "drizzle-orm";
import { differenceInMinutes, parse } from "date-fns";
import { lockEmployeePunchWrites } from "./punch-write-lock";
import { ORDER_BOOKER_TRIP_ENTRY_SOURCE } from "@/lib/attendance/order-booker-day-state";
import { getBusinessDateRange } from "@/server-functions/sales/order-booker-trip-day-state";

function calculateHours(checkIn?: string | null, checkOut?: string | null) {
  if (!checkIn || !checkOut) return 0;
  try {
    // Try HH:mm:ss first (common in some browsers/data), then fallback to HH:mm
    let start = parse(checkIn, "HH:mm:ss", new Date());
    if (isNaN(start.getTime())) {
      start = parse(checkIn, "HH:mm", new Date());
    }

    let end = parse(checkOut, "HH:mm:ss", new Date());
    if (isNaN(end.getTime())) {
      end = parse(checkOut, "HH:mm", new Date());
    }

    // If either is still invalid, return 0
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

    let diff = differenceInMinutes(end, start);
    if (diff < 0) diff += 24 * 60; // Handle overnight shift
    return diff / 60;
  } catch (e) {
    return 0;
  }
}

function normalizeSubmittedHours(value?: string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsedHours = Number(value);
  if (!Number.isFinite(parsedHours) || parsedHours < 0) return null;
  return parsedHours.toFixed(2);
}

export const upsertAttendanceFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(upsertAttendanceSchema)
  .handler(async ({ data }) => {
    const { employeeId, date, ...rest } = data;

    const [employee, existingAttendance, punchRecord] = await Promise.all([
      db.query.employees.findFirst({
        where: eq(employees.id, employeeId),
      }),
      db.query.attendance.findFirst({
        where: and(
          eq(attendance.employeeId, employeeId),
          eq(attendance.date, date),
        ),
        columns: {
          dutyHours: true,
        },
      }),
      db.query.attendancePunches.findFirst({
        where: and(
          eq(attendancePunches.employeeId, employeeId),
          eq(attendancePunches.attendanceDate, date),
        ),
        columns: {
          id: true,
        },
      }),
    ]);

    if (!employee) throw new Error("Employee not found");

    const standardHours = employee.standardDutyHours || 8;
    const trimmedOvertimeRemarks = rest.overtimeRemarks?.trim() || null;
    const requestedOvertimeHours = normalizeRequestedOvertimeHours(
      rest.overtimeHours,
    );

    let finalDutyHours: string;

    const submittedDutyHours = normalizeSubmittedHours(rest.dutyHours);
    const punchDrivenDutyHours = normalizeSubmittedHours(
      existingAttendance?.dutyHours,
    );
    const hasPunches = Boolean(punchRecord);

    // Fallback only for legacy/manual rows that do not send computed hours.
    const totalDuty = calculateHours(rest.checkIn, rest.checkOut) || 0;

    if (submittedDutyHours !== null) {
      finalDutyHours = submittedDutyHours;
    } else if (hasPunches && punchDrivenDutyHours !== null) {
      finalDutyHours = punchDrivenDutyHours;
    } else if (totalDuty > 0) {
      finalDutyHours = totalDuty.toFixed(2);
    } else if (rest.status === "present" && !hasPunches) {
      finalDutyHours = standardHours.toFixed(2);
    } else {
      finalDutyHours = "0.00";
    }

    const isPresent = rest.status === "present";
    const isLeave = rest.status === "leave";
    const hasOvertime = isPresent && requestedOvertimeHours > 0;

    if (employee.isOrderBooker) {
      return await db.transaction(async (tx) => {
        const linkedOrderBooker = await tx.query.orderBookers.findFirst({
          where: eq(orderBookers.employeeId, employeeId),
          columns: { id: true },
        });
        const tripRange = getBusinessDateRange(date);
        const trips =
          linkedOrderBooker
            ? await tx.query.orderBookerTrips.findMany({
                where: and(
                  eq(orderBookerTrips.orderBookerId, linkedOrderBooker.id),
                  gte(orderBookerTrips.tripDate, tripRange.start),
                  lt(orderBookerTrips.tripDate, tripRange.endExclusive),
                ),
                columns: { id: true },
              })
            : [];
        const hasTrips = trips.length > 0;

        if (
          hasTrips &&
          (rest.status === "absent" ||
            rest.status === "leave" ||
            rest.status === "holiday")
        ) {
          throw new Error(
            "This date has trip records, so it must stay Present. Edit or delete the trip first.",
          );
        }

        const trimmedNotes = rest.notes?.trim() || null;
        if (!hasTrips && !trimmedNotes) {
          throw new Error(
            "A remark is required when manually resolving an order-booker day.",
          );
        }

        const orderBookerUpdateData = {
          status: rest.status,
          checkIn: null,
          checkOut: null,
          dutyHours: isPresent ? standardHours.toFixed(2) : "0.00",
          overtimeHours: "0.00",
          isLate: false,
          isNightShift: false,
          isApprovedLeave: isLeave ? (rest.isApprovedLeave ?? false) : false,
          leaveType: isLeave ? (rest.leaveType ?? null) : null,
          leaveApprovalStatus: isLeave
            ? (rest.leaveApprovalStatus ?? "pending")
            : "none",
          earlyDepartureStatus: "none",
          overtimeRemarks: null,
          compensatoryHoursUsed: isLeave && rest.leaveType === "compensatory" ? (rest.compensatoryHoursUsed ?? "0") : "0",
          overtimeStatus: "pending" as const,
          entrySource: hasTrips ? ORDER_BOOKER_TRIP_ENTRY_SOURCE : "manual",
          notes: trimmedNotes,
          updatedAt: new Date(),
        };

        const [upserted] = await tx
          .insert(attendance)
          .values({ employeeId, date, ...orderBookerUpdateData })
          .onConflictDoUpdate({
            target: [attendance.employeeId, attendance.date],
            set: orderBookerUpdateData,
          })
          .returning();

        return upserted;
      });
    }

    const usesPunchDrivenPresentRow =
      !employee.isOrderBooker && rest.status === "present" && hasPunches;

    if (usesPunchDrivenPresentRow) {
      return await db.transaction(async (tx) => {
        await lockEmployeePunchWrites(tx, employeeId);

        const punchDrivenAttendance = await recomputeAttendanceRow(
          tx,
          employeeId,
          date,
          {
            noteOverride: rest.notes || null,
            manualFieldStrategy: "preserve",
          },
        );

        if (!punchDrivenAttendance) {
          throw new Error("Punch-driven attendance could not be recomputed");
        }

        const punchDrivenOvertimeSummary = buildOvertimeRequestSummary({
          dutyHours: punchDrivenAttendance.dutyHours,
          standardDutyHours: standardHours,
          requestedOvertimeHours,
        });

        if (punchDrivenOvertimeSummary.state === "stale") {
          throw new Error(
            punchDrivenOvertimeSummary.warning ||
              "Requested OT cannot be more than the suggested OT.",
          );
        }

        const punchDrivenEarlyLeave =
          punchDrivenAttendance.earlyDepartureStatus === "none"
            ? "none"
            : rest.earlyDepartureStatus === "approved" ||
                rest.earlyDepartureStatus === "rejected"
              ? rest.earlyDepartureStatus
              : punchDrivenAttendance.earlyDepartureStatus;
        const hasRequestedPunchDrivenOvertime =
          punchDrivenOvertimeSummary.requestedOvertimeHours > 0;

        const updateData = {
          status: "present" as const,
          checkIn: punchDrivenAttendance.checkIn,
          checkOut: punchDrivenAttendance.checkOut,
          dutyHours: punchDrivenAttendance.dutyHours ?? "0.00",
          overtimeHours: hasRequestedPunchDrivenOvertime
            ? punchDrivenOvertimeSummary.requestedOvertimeHours.toFixed(2)
            : "0.00",
          isLate: punchDrivenAttendance.isLate ?? false,
          isNightShift: punchDrivenAttendance.isNightShift ?? false,
          isApprovedLeave: false,
          leaveType: null,
          leaveApprovalStatus: "none" as const,
          earlyDepartureStatus: punchDrivenEarlyLeave,
          compensatoryHoursUsed: "0",
          overtimeRemarks: hasRequestedPunchDrivenOvertime
            ? trimmedOvertimeRemarks
            : null,
          overtimeStatus: "pending" as const,
          entrySource: punchDrivenAttendance.entrySource || "manual",
          notes: rest.notes || null,
          updatedAt: new Date(),
        };

        const [upserted] = await tx
          .insert(attendance)
          .values({ employeeId, date, ...updateData })
          .onConflictDoUpdate({
            target: [attendance.employeeId, attendance.date],
            set: updateData,
          })
          .returning();

        return upserted;
      });
    }

    const updateData = {
      status: rest.status,
      checkIn: isPresent ? (rest.checkIn || null) : null,
      checkOut: isPresent ? (rest.checkOut || null) : null,
      dutyHours: isPresent ? finalDutyHours : "0.00",
      overtimeHours: hasOvertime ? requestedOvertimeHours.toFixed(2) : "0.00",
      isLate: isPresent ? (rest.isLate ?? false) : false,
      isNightShift: isPresent ? (rest.isNightShift ?? false) : false,
      isApprovedLeave: isLeave ? (rest.isApprovedLeave ?? false) : false,
      leaveType: isLeave ? (rest.leaveType ?? null) : null,
      leaveApprovalStatus:
        isLeave
          ? (rest.leaveApprovalStatus ?? "pending")
          : "none",
      earlyDepartureStatus: isPresent
        ? (rest.earlyDepartureStatus ?? "none")
        : "none",
      compensatoryHoursUsed: isLeave && rest.leaveType === "compensatory" ? (rest.compensatoryHoursUsed ?? "0") : "0",
      overtimeRemarks: hasOvertime ? trimmedOvertimeRemarks : null,
      overtimeStatus: hasOvertime ? (rest.overtimeStatus || "pending") : "pending",
      entrySource: rest.entrySource || "manual",
      notes: rest.notes || null,

      updatedAt: new Date(),
    };

    return await db.transaction(async (tx) => {
      // 1. Fetch existing attendance and employee to manage compensatory balance
      const existingAttendance = await tx.query.attendance.findFirst({
        where: and(eq(attendance.employeeId, employeeId), eq(attendance.date, date))
      });
      const emp = await tx.query.employees.findFirst({
        where: eq(employees.id, employeeId),
        columns: { compensatoryHoursBalance: true }
      });

      if (emp) {
        const previousCompUsed = existingAttendance?.leaveType === "compensatory" 
          ? parseFloat(existingAttendance.compensatoryHoursUsed || "0") 
          : 0;
        const newCompUsed = updateData.leaveType === "compensatory" 
          ? parseFloat(updateData.compensatoryHoursUsed || "0") 
          : 0;
        const compHoursDiff = newCompUsed - previousCompUsed;

        if (compHoursDiff !== 0) {
          const currentBalance = parseFloat(emp.compensatoryHoursBalance || "0");
          const newBalance = currentBalance - compHoursDiff;

          if (newBalance < 0) {
            throw new Error(`Insufficient compensatory leave balance. Available: ${currentBalance}h, trying to use: ${newCompUsed}h`);
          }

          await tx.update(employees)
            .set({ compensatoryHoursBalance: newBalance.toString() })
            .where(eq(employees.id, employeeId));
        }
      }

      const [upserted] = await tx
        .insert(attendance)
        .values({ employeeId, date, ...updateData })
        .onConflictDoUpdate({
          target: [attendance.employeeId, attendance.date],
          set: updateData,
        })
        .returning();
      return upserted;
    });
  });
