import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import { driverTrips, drivers } from "@/db/schemas/sales-erp-schema";

export const DRIVER_TRIP_ENTRY_SOURCE = "driver_trip" as const;

export type DriverDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DriverDbExecutor = typeof db | DriverDbTransaction;

export function getDriverBusinessDateRange(businessDate: string): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(`${businessDate}T00:00:00+05:00`);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

export async function syncDriverAttendanceForDate(args: {
  tx: DriverDbTransaction;
  driverId: string;
  businessDate: string;
  standardDutyHours?: number;
}): Promise<{ status: "synced" | "skipped_manual" | "deleted" | "no_op" }> {
  const driver = await args.tx.query.drivers.findFirst({
    where: eq(drivers.id, args.driverId),
    columns: { id: true, employeeId: true },
  });

  if (!driver || !driver.employeeId) {
    return { status: "no_op" };
  }

  const employee = await args.tx.query.employees.findFirst({
    where: eq(employees.id, driver.employeeId),
    columns: { id: true, standardDutyHours: true, status: true },
  });

  if (!employee || employee.status !== "active") {
    return { status: "no_op" };
  }

  const { start, endExclusive } = getDriverBusinessDateRange(args.businessDate);

  const [existingAttendance, tripsCountResult] = await Promise.all([
    args.tx.query.attendance.findFirst({
      where: and(
        eq(attendance.employeeId, employee.id),
        eq(attendance.date, args.businessDate),
      ),
    }),
    args.tx
      .select({ count: sql<number>`count(*)` })
      .from(driverTrips)
      .where(
        and(
          eq(driverTrips.driverId, args.driverId),
          gte(driverTrips.tripDate, start),
          lt(driverTrips.tripDate, endExclusive),
        ),
      ),
  ]);

  // HR Precedence: Protect manual HR records from overwrite
  if (
    existingAttendance &&
    existingAttendance.entrySource !== DRIVER_TRIP_ENTRY_SOURCE
  ) {
    return { status: "skipped_manual" };
  }

  const totalTrips = Number(tripsCountResult[0]?.count || 0);

  if (totalTrips === 0) {
    if (
      existingAttendance &&
      existingAttendance.entrySource === DRIVER_TRIP_ENTRY_SOURCE
    ) {
      await args.tx
        .delete(attendance)
        .where(eq(attendance.id, existingAttendance.id));
      return { status: "deleted" };
    }
    return { status: "no_op" };
  }

  const dutyHours = Math.max(
    args.standardDutyHours ??
      (employee.standardDutyHours != null
        ? Number(employee.standardDutyHours)
        : 8),
    0,
  ).toFixed(2);

  const now = new Date();

  await args.tx
    .insert(attendance)
    .values({
      employeeId: employee.id,
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
      entrySource: DRIVER_TRIP_ENTRY_SOURCE,
      notes: "Auto-synced from driver trips",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [attendance.employeeId, attendance.date],
      set: {
        status: "present",
        checkIn: null,
        checkOut: null,
        dutyHours,
        entrySource: DRIVER_TRIP_ENTRY_SOURCE,
        updatedAt: now,
      },
    });

  return { status: "synced" };
}
