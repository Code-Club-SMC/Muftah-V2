import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { drivers, driverTrips } from "@/db/schemas/sales-erp-schema";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { toPKTDate } from "@/lib/attendance/time";
import { getDriverBusinessDateRange } from "@/server-functions/hr/attendance/driver-attendance-sync";

export type DriverActivityStatus =
  | "present"
  | "pending_review"
  | "rest_day"
  | "absent"
  | "leave"
  | "holiday";

export type DriverActivityDay = {
  date: string;
  weekday: string;
  status: DriverActivityStatus;
  attendanceStatus: "present" | "absent" | "leave" | "holiday" | null;
  attendanceEntrySource: string | null;
  isRestDay: boolean;
  tripCount: number;
  totalDistanceKm: number;
  totalTadaAmount: number;
  destinations: string[];
  vehicleNumbers: string[];
  trips: {
    id: string;
    destination: string;
    vehicleNumber: string | null;
    distanceKm: number;
    ratePerKm: number;
    tadaAmount: number;
    notes: string | null;
  }[];
  notes: string[];
};

export function resolveDriverActivityStatus(args: {
  attendanceRow: { status: "present" | "absent" | "leave" | "holiday" } | null | undefined;
  isRestDay: boolean;
  tripCount: number;
}): DriverActivityStatus {
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

export const getDriverActivityLogFn = createServerFn()
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
        isDriver: true,
      },
    });

    if (!employee) throw new Error("Employee not found.");
    if (!employee.isDriver) {
      throw new Error("Employee is not a driver.");
    }

    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.employeeId, employeeId),
      columns: {
        id: true,
        name: true,
        phone: true,
        licenseNumber: true,
        status: true,
      },
    });

    if (!driver) {
      throw new Error("No driver profile is linked to this employee.");
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

    const rangeStart = getDriverBusinessDateRange(startDate).start;
    const rangeEnd = getDriverBusinessDateRange(endDate).endExclusive;

    const trips = await db.query.driverTrips.findMany({
      where: and(
        eq(driverTrips.driverId, driver.id),
        gte(driverTrips.tripDate, rangeStart),
        lt(driverTrips.tripDate, rangeEnd),
      ),
      orderBy: asc(driverTrips.tripDate),
    });

    const tripsByDate = new Map<string, typeof trips>();
    for (const trip of trips) {
      const date = toPKTDate(trip.tripDate);
      const list = tripsByDate.get(date) ?? [];
      list.push(trip);
      tripsByDate.set(date, list);
    }

    const restDays = employee.restDays ?? [0];
    const dates = eachDayOfInterval({
      start: parseISO(startDate),
      end: parseISO(endDate),
    });

    const rows: DriverActivityDay[] = dates.map((day) => {
      const date = format(day, "yyyy-MM-dd");
      const dayTrips = tripsByDate.get(date) ?? [];
      const attendanceRow = attendanceByDate.get(date);

      const totalDistanceKm = dayTrips.reduce(
        (sum, t) => sum + Number(t.distanceKm || 0),
        0,
      );
      const totalTadaAmount = dayTrips.reduce(
        (sum, t) => sum + Number(t.tadaAmount || 0),
        0,
      );

      const isRest = restDays.includes(day.getDay());
      const status = resolveDriverActivityStatus({
        attendanceRow: attendanceRow
          ? { status: attendanceRow.status as any }
          : null,
        isRestDay: isRest,
        tripCount: dayTrips.length,
      });

      const notes: string[] = [];
      if (attendanceRow?.notes) notes.push(attendanceRow.notes);

      const destinations = Array.from(
        new Set(dayTrips.map((t) => t.destination).filter(Boolean)),
      );
      const vehicleNumbers = Array.from(
        new Set(dayTrips.map((t) => t.vehicleNumber).filter((v): v is string => Boolean(v))),
      );

      return {
        date,
        weekday: format(day, "EEE"),
        status,
        attendanceStatus: (attendanceRow?.status as any) ?? null,
        attendanceEntrySource: attendanceRow?.entrySource ?? null,
        isRestDay: isRest,
        tripCount: dayTrips.length,
        totalDistanceKm,
        totalTadaAmount,
        destinations,
        vehicleNumbers,
        trips: dayTrips.map((t) => ({
          id: t.id,
          destination: t.destination,
          vehicleNumber: t.vehicleNumber,
          distanceKm: Number(t.distanceKm || 0),
          ratePerKm: Number(t.ratePerKm || 0),
          tadaAmount: Number(t.tadaAmount || 0),
          notes: t.notes,
        })),
        notes,
      };
    });

    const summary = rows.reduce(
      (acc, r) => {
        acc.totalTrips += r.tripCount;
        acc.totalDistanceKm += r.totalDistanceKm;
        acc.totalTadaAmount += r.totalTadaAmount;
        if (r.status === "present") acc.presentDays += 1;
        if (r.status === "rest_day") acc.restDays += 1;
        if (r.status === "absent") acc.absentDays += 1;
        if (r.status === "leave") acc.leaveDays += 1;
        if (r.status === "holiday") acc.holidayDays += 1;
        if (r.status === "pending_review") acc.pendingDays += 1;
        return acc;
      },
      {
        totalTrips: 0,
        totalDistanceKm: 0,
        totalTadaAmount: 0,
        presentDays: 0,
        restDays: 0,
        absentDays: 0,
        leaveDays: 0,
        holidayDays: 0,
        pendingDays: 0,
      },
    );

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        driverId: driver.id,
        phone: driver.phone,
        licenseNumber: driver.licenseNumber,
        status: driver.status,
      },
      dateRange: { startDate, endDate },
      summary,
      days: rows,
    };
  });
