import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  employees,
} from "@/db/schemas/hr-schema";
import { orderBookers, orderBookerTrips } from "@/db/schemas/sales-erp-schema";
import {
  buildOvertimeRequestSummary,
  getOvertimeStandardDutyHours,
  normalizeRequestedOvertimeHours,
} from "@/lib/attendance/overtime-request";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";
import { upsertAttendanceSchema } from "@/lib/validators/hr-validators";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import { and, eq, gte, lt } from "drizzle-orm";
import { differenceInMinutes, parse } from "date-fns";
import { lockEmployeePunchWrites } from "./punch-write-lock";
import {
  invalidateDeviceAttendanceChanges,
  lockAttendancePayrollWrites,
} from "@/lib/attendance/device-import/payroll.server";
import { ORDER_BOOKER_TRIP_ENTRY_SOURCE } from "@/lib/attendance/order-booker-day-state";
import { getBusinessDateRange } from "@/server-functions/sales/order-booker-trip-day-state";
import { assertWorkingLeaveDate } from "@/lib/attendance/leave-policy";
import { adjustCompensatoryReservation } from "@/lib/attendance/compensatory-reservation.server";

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

    return await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      await lockEmployeePunchWrites(tx, employeeId);
      const [employee, previousAttendance, punchRecord] = await Promise.all([
        tx.query.employees.findFirst({
          where: eq(employees.id, employeeId),
        }),
        tx.query.attendance.findFirst({
          where: and(
            eq(attendance.employeeId, employeeId),
            eq(attendance.date, date),
          ),
        }),
        tx.query.attendancePunches.findFirst({
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
      await invalidateDeviceAttendanceChanges(tx, employeeId, [date]);

      const standardHours = employee.standardDutyHours || 8;
      const trimmedOvertimeRemarks = rest.overtimeRemarks?.trim() || null;
      const requestedOvertimeHours = normalizeRequestedOvertimeHours(
        rest.overtimeHours,
      );

      let finalDutyHours: string;

      const submittedDutyHours = normalizeSubmittedHours(rest.dutyHours);
      const punchDrivenDutyHours = normalizeSubmittedHours(
        previousAttendance?.dutyHours,
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
      if (isLeave) {
        assertWorkingLeaveDate(date, employee.restDays, previousAttendance?.status);
      }
      const compensatoryHoursUsed =
        isLeave && rest.leaveType === "compensatory" && rest.leaveApprovalStatus !== "rejected"
          ? (rest.compensatoryHoursUsed ?? "0") : "0";
      const isFieldWorker = Boolean(employee.isOrderBooker || employee.isSalesman || employee.isDriver);
      const usesPunchDrivenPresentRow = !isFieldWorker && rest.status === "present" && hasPunches;
      // Punch recomputation refunds reserved hours itself, including banked cover on present rows.
      if (!usesPunchDrivenPresentRow) {
        await adjustCompensatoryReservation(tx, employeeId,
          previousAttendance?.compensatoryHoursUsed ?? "0",
          compensatoryHoursUsed);
      }

      if (employee.isOrderBooker) {
        const linkedOrderBooker = await tx.query.orderBookers.findFirst({
          where: eq(orderBookers.employeeId, employeeId),
          columns: { id: true },
        });
        const tripRange = getBusinessDateRange(date);
        const trips = linkedOrderBooker
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
          compensatoryHoursUsed,
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
      }

      if (usesPunchDrivenPresentRow) {
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
          standardDutyHours: getOvertimeStandardDutyHours(date, employee),
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
          // Recomputation already capped any banked cover and refunded the rest.
          compensatoryHoursUsed: punchDrivenAttendance.compensatoryHoursUsed ?? "0",
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
      }

      const updateData = {
        status: rest.status,
        checkIn: isPresent ? rest.checkIn || null : null,
        checkOut: isPresent ? rest.checkOut || null : null,
        dutyHours: isPresent ? finalDutyHours : "0.00",
        overtimeHours: hasOvertime ? requestedOvertimeHours.toFixed(2) : "0.00",
        isLate: isPresent ? (rest.isLate ?? false) : false,
        isNightShift: isPresent ? (rest.isNightShift ?? false) : false,
        isApprovedLeave: isLeave ? (rest.isApprovedLeave ?? false) : false,
        leaveType: isLeave ? (rest.leaveType ?? null) : null,
        leaveApprovalStatus: isLeave
          ? (rest.leaveApprovalStatus ?? "pending")
          : "none",
        earlyDepartureStatus: isPresent
          ? (rest.earlyDepartureStatus ?? "none")
          : "none",
        compensatoryHoursUsed,
        overtimeRemarks: hasOvertime ? trimmedOvertimeRemarks : null,
        overtimeStatus: hasOvertime
          ? rest.overtimeStatus || "pending"
          : "pending",
        entrySource: rest.entrySource || "manual",
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
  });
