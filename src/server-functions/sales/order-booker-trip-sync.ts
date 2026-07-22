import { and, eq, gte, lt } from "drizzle-orm";
import { attendance } from "@/db/schemas/hr-schema";
import { orderBookerTrips } from "@/db/schemas/sales-erp-schema";
import { ORDER_BOOKER_TRIP_ENTRY_SOURCE } from "@/lib/attendance/order-booker-day-state";
import {
  getBusinessDateRange,
  isManualOrderBookerAttendanceRow,
  isTripDrivenOrderBookerAttendanceRow,
  type SalesDbTransaction,
} from "./order-booker-trip-day-state";

export async function syncOrderBookerAttendanceForDate(args: {
  tx: SalesDbTransaction;
  employeeId: string;
  orderBookerId: string;
  businessDate: string;
  standardDutyHours: number;
}): Promise<void> {
  const { start, endExclusive } = getBusinessDateRange(args.businessDate);

  const [trips, existingAttendance] = await Promise.all([
    args.tx.query.orderBookerTrips.findMany({
      where: and(
        eq(orderBookerTrips.orderBookerId, args.orderBookerId),
        gte(orderBookerTrips.tripDate, start),
        lt(orderBookerTrips.tripDate, endExclusive),
      ),
      columns: { id: true },
    }),
    args.tx.query.attendance.findFirst({
      where: and(
        eq(attendance.employeeId, args.employeeId),
        eq(attendance.date, args.businessDate),
      ),
    }),
  ]);

  if (isManualOrderBookerAttendanceRow(existingAttendance)) {
    return;
  }

  if (trips.length === 0) {
    if (
      existingAttendance &&
      isTripDrivenOrderBookerAttendanceRow(existingAttendance)
    ) {
      await args.tx
        .delete(attendance)
        .where(eq(attendance.id, existingAttendance.id));
    }
    return;
  }

  const now = new Date();
  const dutyHours = Math.max(args.standardDutyHours || 8, 0).toFixed(2);

  await args.tx
    .insert(attendance)
    .values({
      employeeId: args.employeeId,
      date: args.businessDate,
      status: "present",
      checkIn: null,
      checkOut: null,
      dutyHours,
      overtimeHours: "0.00",
      isLate: false,
      isNightShift: false,
      overtimeStatus: "pending",
      overtimeRemarks: null,
      earlyDepartureStatus: "none",
      checkOutReason: null,
      shiftViolations: [],
      isApprovedLeave: false,
      leaveApprovalStatus: "none",
      leaveType: null,
      entrySource: ORDER_BOOKER_TRIP_ENTRY_SOURCE,
      notes: null,
      areaVisited: null,
      isCompanyVehicle: false,
      paymentMode: null,
      distanceKm: "0",
      perKmRate: "0",
      petrolAmount: "0",
      saleAmount: "0",
      recoveryAmount: "0",
      returnAmount: "0",
      shopType: null,
      slipNumbers: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [attendance.employeeId, attendance.date],
      set: {
        status: "present",
        checkIn: null,
        checkOut: null,
        dutyHours,
        overtimeHours: "0.00",
        isLate: false,
        isNightShift: false,
        overtimeStatus: "pending",
        overtimeRemarks: null,
        earlyDepartureStatus: "none",
        checkOutReason: null,
        shiftViolations: [],
        isApprovedLeave: false,
        leaveApprovalStatus: "none",
        leaveType: null,
        entrySource: ORDER_BOOKER_TRIP_ENTRY_SOURCE,
        notes: null,
        areaVisited: null,
        isCompanyVehicle: false,
        paymentMode: null,
        distanceKm: "0",
        perKmRate: "0",
        petrolAmount: "0",
        saleAmount: "0",
        recoveryAmount: "0",
        returnAmount: "0",
        shopType: null,
        slipNumbers: null,
        updatedAt: now,
      },
    });
}
