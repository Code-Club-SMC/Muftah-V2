import { and, eq, gte, lt, ne } from "drizzle-orm";
import { attendance, employees } from "@/db/schemas/hr-schema";
import {
  orderBookers,
  orderBookerTrips,
} from "@/db/schemas/sales-erp-schema";
import { toPKTDate } from "@/lib/attendance/time";
import {
  ORDER_BOOKER_TRIP_ENTRY_SOURCE,
  type OrderBookerBlockingStatus,
  type OrderBookerManualStatus,
  type OrderBookerTripBlockReason,
  type OrderBookerTripEligibilityResult,
} from "@/lib/attendance/order-booker-day-state";
import type { db } from "@/db";

export type SalesDbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export type SalesDbExecutor = typeof db | SalesDbTransaction;

type AttendanceRowForClassification = {
  id?: string | null;
  status?: string | null;
  entrySource?: string | null;
};

export function getBusinessDateFromTripDate(value: string | Date): string {
  return toPKTDate(value);
}

export function getBusinessDateRange(businessDate: string): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(`${businessDate}T00:00:00+05:00`);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, endExclusive };
}

export function getBusinessDateWeekday(businessDate: string): number {
  const [year, month, day] = businessDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

export function isBusinessDateRestDay(
  businessDate: string,
  restDays: number[] | null | undefined,
): boolean {
  const configuredRestDays = restDays ?? [0];
  if (configuredRestDays.length === 0) return false;

  return configuredRestDays.includes(getBusinessDateWeekday(businessDate));
}

export function isTripDrivenOrderBookerAttendanceRow(
  row: AttendanceRowForClassification | null | undefined,
): boolean {
  return row?.entrySource === ORDER_BOOKER_TRIP_ENTRY_SOURCE;
}

export function isManualOrderBookerAttendanceRow(
  row: AttendanceRowForClassification | null | undefined,
): boolean {
  return !!row && !isTripDrivenOrderBookerAttendanceRow(row);
}

export function getOrderBookerManualStatus(
  row: AttendanceRowForClassification | null | undefined,
): OrderBookerManualStatus | null {
  if (!isManualOrderBookerAttendanceRow(row)) return null;
  if (
    row?.status === "present" ||
    row?.status === "absent" ||
    row?.status === "leave" ||
    row?.status === "holiday"
  ) {
    return row.status;
  }
  return null;
}

export function getOrderBookerBlockingStatus(args: {
  isRestDay: boolean;
  attendanceRow: AttendanceRowForClassification | null | undefined;
}): OrderBookerBlockingStatus | null {
  if (args.isRestDay) return "rest_day";

  const manualStatus = getOrderBookerManualStatus(args.attendanceRow);
  if (
    manualStatus === "holiday" ||
    manualStatus === "leave" ||
    manualStatus === "absent"
  ) {
    return manualStatus;
  }

  return null;
}

export function getOrderBookerTripBlockMessage(
  reason: OrderBookerTripBlockReason | null,
): string | null {
  switch (reason) {
    case "rest_day":
      return "Trips cannot be logged on this employee's rest day.";
    case "holiday":
      return "Trips cannot be logged because HR marked this date as a holiday.";
    case "leave":
      return "Trips cannot be logged because HR marked this employee on leave.";
    case "absent":
      return "Trips cannot be logged because HR marked this employee absent.";
    case "order_booker_not_linked_to_employee":
      return "This order booker is not linked to an HR employee.";
    case "employee_inactive":
      return "Trips cannot be logged for an inactive employee.";
    case null:
      return null;
  }
}

export function assertOrderBookerTripAllowed(
  state: Pick<OrderBookerTripEligibilityResult, "isAllowed" | "reasonMessage">,
): void {
  if (!state.isAllowed) {
    throw new Error(state.reasonMessage ?? "Trip is not allowed for this date.");
  }
}

export async function resolveOrderBookerTripEligibility(args: {
  tx: SalesDbExecutor;
  orderBookerId: string;
  tripDate: string | Date;
  excludeTripId?: string;
}): Promise<OrderBookerTripEligibilityResult> {
  const orderBooker = await args.tx.query.orderBookers.findFirst({
    where: eq(orderBookers.id, args.orderBookerId),
  });

  if (!orderBooker) {
    throw new Error("Order booker not found.");
  }

  const businessDate = getBusinessDateFromTripDate(args.tripDate);
  const { start, endExclusive } = getBusinessDateRange(businessDate);

  if (!orderBooker.employeeId) {
    return {
      employeeId: "",
      orderBookerId: orderBooker.id,
      businessDate,
      isRestDay: false,
      blockingStatus: null,
      hasManualAttendanceRow: false,
      manualStatus: null,
      existingTripCount: 0,
      isAllowed: false,
      reason: "order_booker_not_linked_to_employee",
      reasonMessage: getOrderBookerTripBlockMessage(
        "order_booker_not_linked_to_employee",
      ),
      attendanceRowId: null,
      attendanceEntrySource: null,
      employeeStatus: null,
      standardDutyHours: 0,
    };
  }

  const employee = await args.tx.query.employees.findFirst({
    where: eq(employees.id, orderBooker.employeeId),
  });

  if (!employee) {
    return {
      employeeId: orderBooker.employeeId,
      orderBookerId: orderBooker.id,
      businessDate,
      isRestDay: false,
      blockingStatus: null,
      hasManualAttendanceRow: false,
      manualStatus: null,
      existingTripCount: 0,
      isAllowed: false,
      reason: "order_booker_not_linked_to_employee",
      reasonMessage: getOrderBookerTripBlockMessage(
        "order_booker_not_linked_to_employee",
      ),
      attendanceRowId: null,
      attendanceEntrySource: null,
      employeeStatus: null,
      standardDutyHours: 0,
    };
  }

  const isRestDay = isBusinessDateRestDay(businessDate, employee.restDays);

  const attendanceRow = await args.tx.query.attendance.findFirst({
    where: and(
      eq(attendance.employeeId, employee.id),
      eq(attendance.date, businessDate),
    ),
  });

  const tripConditions = [
    eq(orderBookerTrips.orderBookerId, orderBooker.id),
    gte(orderBookerTrips.tripDate, start),
    lt(orderBookerTrips.tripDate, endExclusive),
  ];

  if (args.excludeTripId) {
    tripConditions.push(ne(orderBookerTrips.id, args.excludeTripId));
  }

  const existingTrips = await args.tx.query.orderBookerTrips.findMany({
    where: and(...tripConditions),
    columns: { id: true },
  });

  const manualStatus = getOrderBookerManualStatus(attendanceRow);
  const blockingStatus = getOrderBookerBlockingStatus({
    isRestDay,
    attendanceRow,
  });
  const inactiveReason =
    employee.status === "active" ? null : ("employee_inactive" as const);
  const reason = inactiveReason ?? blockingStatus;

  return {
    employeeId: employee.id,
    orderBookerId: orderBooker.id,
    businessDate,
    isRestDay,
    blockingStatus,
    hasManualAttendanceRow: isManualOrderBookerAttendanceRow(attendanceRow),
    manualStatus,
    existingTripCount: existingTrips.length,
    isAllowed: reason === null,
    reason,
    reasonMessage: getOrderBookerTripBlockMessage(reason),
    attendanceRowId: attendanceRow?.id ?? null,
    attendanceEntrySource: attendanceRow?.entrySource ?? null,
    employeeStatus: employee.status,
    standardDutyHours: employee.standardDutyHours ?? 8,
  };
}
