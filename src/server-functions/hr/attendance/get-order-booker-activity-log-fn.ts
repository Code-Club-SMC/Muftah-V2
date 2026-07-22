import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import {
  orderBookers,
  orderBookerTrips,
} from "@/db/schemas/sales-erp-schema";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { toPKTDate } from "@/lib/attendance/time";
import {
  ORDER_BOOKER_TRIP_ENTRY_SOURCE,
  type AttendanceEntrySource,
} from "@/lib/attendance/order-booker-day-state";
import { getBusinessDateRange } from "@/server-functions/sales/order-booker-trip-day-state";

export type OrderBookerActivityStatus =
  | "present"
  | "pending_review"
  | "rest_day"
  | "absent"
  | "leave"
  | "holiday";

export type OrderBookerActivityDay = {
  date: string;
  weekday: string;
  status: OrderBookerActivityStatus;
  attendanceStatus: "present" | "absent" | "leave" | "holiday" | null;
  attendanceEntrySource: AttendanceEntrySource | string | null;
  isRestDay: boolean;
  tripCount: number;
  orderCount: number;
  emptyTripCount: number;
  orderTripCount: number;
  totalDistanceKm: number;
  totalFuelCost: number;
  totalTadaAmount: number;
  totalOrderValue: number;
  oldShopVisits: number;
  newShopVisits: number;
  destinations: string[];
  notes: string[];
};

type AttendanceStatus = "present" | "absent" | "leave" | "holiday";

type AttendanceRowForActivity = {
  status: AttendanceStatus;
  entrySource: string | null;
};

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBusinessDateRestDay(date: string, restDays: number[]): boolean {
  if (restDays.length === 0) return false;
  return restDays.includes(parseISO(date).getDay());
}

export function resolveOrderBookerActivityStatus(args: {
  attendanceRow: AttendanceRowForActivity | null | undefined;
  isRestDay: boolean;
  tripCount: number;
}): OrderBookerActivityStatus {
  if (
    args.attendanceRow?.status === "absent" ||
    args.attendanceRow?.status === "leave" ||
    args.attendanceRow?.status === "holiday"
  ) {
    return args.attendanceRow.status;
  }

  if (args.attendanceRow?.status === "present" || args.tripCount > 0) {
    return "present";
  }

  if (args.isRestDay) return "rest_day";

  return "pending_review";
}

export const getOrderBookerActivityLogFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        employeeId: z.string().min(1),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { employeeId, startDate, endDate } = data;

    if (startDate > endDate) {
      throw new Error("Start date cannot be after end date.");
    }

    const employee = await db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        designation: true,
        restDays: true,
        isOrderBooker: true,
      },
    });

    if (!employee) throw new Error("Employee not found.");
    if (!employee.isOrderBooker) {
      throw new Error("Employee is not an order booker.");
    }

    const orderBooker = await db.query.orderBookers.findFirst({
      where: eq(orderBookers.employeeId, employeeId),
      columns: {
        id: true,
        name: true,
        assignedArea: true,
        status: true,
      },
    });

    if (!orderBooker) {
      throw new Error("No order booker is linked to this employee.");
    }

    const attendanceEndExclusive = format(
      addDays(parseISO(endDate), 1),
      "yyyy-MM-dd",
    );

    const attendanceRows = await db.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        gte(attendance.date, startDate),
        lt(attendance.date, attendanceEndExclusive),
      ),
      orderBy: asc(attendance.date),
      columns: {
        date: true,
        status: true,
        entrySource: true,
        notes: true,
      },
    });

    const attendanceByDate = new Map(
      attendanceRows.map((row) => [row.date, row]),
    );

    const tripStart = getBusinessDateRange(startDate).start;
    const tripEndExclusive = getBusinessDateRange(endDate).endExclusive;

    const trips = await db.query.orderBookerTrips.findMany({
      where: and(
        eq(orderBookerTrips.orderBookerId, orderBooker.id),
        gte(orderBookerTrips.tripDate, tripStart),
        lt(orderBookerTrips.tripDate, tripEndExclusive),
      ),
      orderBy: asc(orderBookerTrips.tripDate),
      with: {
        orders: {
          columns: {
            id: true,
            billNumber: true,
            status: true,
            shopkeeperName: true,
          },
          with: {
            items: {
              columns: {
                amount: true,
              },
            },
          },
        },
      },
    });

    const tripsByDate = new Map<string, typeof trips>();
    for (const trip of trips) {
      const date = toPKTDate(trip.tripDate);
      const dateTrips = tripsByDate.get(date) ?? [];
      dateTrips.push(trip);
      tripsByDate.set(date, dateTrips);
    }

    const restDays = employee.restDays ?? [0];
    const dates = eachDayOfInterval({
      start: parseISO(startDate),
      end: parseISO(endDate),
    });

    const rows: OrderBookerActivityDay[] = dates.map((day) => {
      const date = format(day, "yyyy-MM-dd");
      const dayTrips = tripsByDate.get(date) ?? [];
      const attendanceRow = attendanceByDate.get(date);
      const orderCount = dayTrips.reduce(
        (count, trip) => count + trip.orders.length,
        0,
      );
      const totalOrderValue = dayTrips.reduce(
        (sum, trip) =>
          sum +
          trip.orders.reduce(
            (orderSum, order) =>
              orderSum +
              order.items.reduce(
                (itemSum, item) => itemSum + numberValue(item.amount),
                0,
              ),
            0,
          ),
        0,
      );
      const notes = [
        ...dayTrips
          .map((trip) => trip.notes?.trim())
          .filter((note): note is string => !!note),
        attendanceRow?.notes?.trim(),
      ].filter((note): note is string => !!note);
      const isRestDay = isBusinessDateRestDay(date, restDays);
      const status = resolveOrderBookerActivityStatus({
        attendanceRow,
        isRestDay,
        tripCount: dayTrips.length,
      });

      return {
        date,
        weekday: format(day, "EEEE"),
        status,
        attendanceStatus: attendanceRow?.status ?? null,
        attendanceEntrySource: attendanceRow?.entrySource ?? null,
        isRestDay,
        tripCount: dayTrips.length,
        orderCount,
        emptyTripCount: dayTrips.filter((trip) => trip.orders.length === 0)
          .length,
        orderTripCount: dayTrips.filter((trip) => trip.orders.length > 0)
          .length,
        totalDistanceKm: dayTrips.reduce(
          (sum, trip) => sum + numberValue(trip.distanceKm),
          0,
        ),
        totalFuelCost: dayTrips.reduce(
          (sum, trip) => sum + numberValue(trip.fuelCost),
          0,
        ),
        totalTadaAmount: dayTrips.reduce(
          (sum, trip) => sum + numberValue(trip.tadaAmount),
          0,
        ),
        totalOrderValue,
        oldShopVisits: dayTrips.filter((trip) => trip.shopType === "old")
          .length,
        newShopVisits: dayTrips.filter((trip) => trip.shopType === "new")
          .length,
        destinations: Array.from(
          new Set(dayTrips.map((trip) => trip.destination).filter(Boolean)),
        ),
        notes,
      };
    });

    const workingRows = rows.filter((row) => row.status !== "rest_day");

    return {
      employee,
      orderBooker,
      rows,
      totals: {
        daysPresent: workingRows.filter((row) => row.status === "present").length,
        pendingReviewDays: workingRows.filter(
          (row) => row.status === "pending_review",
        ).length,
        tripCount: rows.reduce((sum, row) => sum + row.tripCount, 0),
        orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
        emptyTripCount: rows.reduce((sum, row) => sum + row.emptyTripCount, 0),
        totalDistanceKm: rows.reduce((sum, row) => sum + row.totalDistanceKm, 0),
        totalFuelCost: rows.reduce((sum, row) => sum + row.totalFuelCost, 0),
        totalTadaAmount: rows.reduce((sum, row) => sum + row.totalTadaAmount, 0),
        totalOrderValue: rows.reduce((sum, row) => sum + row.totalOrderValue, 0),
        oldShopVisits: rows.reduce((sum, row) => sum + row.oldShopVisits, 0),
        newShopVisits: rows.reduce((sum, row) => sum + row.newShopVisits, 0),
      },
      meta: {
        startDate,
        endDate,
        tripEntrySource: ORDER_BOOKER_TRIP_ENTRY_SOURCE,
      },
    };
  });
