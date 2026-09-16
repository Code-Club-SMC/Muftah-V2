import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { drivers, driverTrips } from "@/db/schemas/sales-erp-schema";
import { tadaRates } from "@/db/schemas/hr-schema";
import {
  requireSalesPeopleViewMiddleware,
  requireSalesPeopleManageMiddleware,
} from "@/lib/middlewares";
import { toPKTDate } from "@/lib/attendance/time";
import { syncDriverAttendanceForDate } from "@/server-functions/hr/attendance/driver-attendance-sync";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// DRIVERS
// ═══════════════════════════════════════════════════════════════════════════

export const listDriversFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input?: any) =>
    z
      .object({
        status: z.enum(["active", "inactive"]).optional(),
      })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [];
    if (data?.status) {
      conditions.push(eq(drivers.status, data.status));
    }
    return await db.query.drivers.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        employee: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
            designation: true,
            status: true,
          },
        },
      },
      orderBy: [desc(drivers.createdAt)],
    });
  });

// ═══════════════════════════════════════════════════════════════════════════
// DRIVER TRIPS
// ═══════════════════════════════════════════════════════════════════════════

export const listDriverTripsFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input?: any) =>
    z
      .object({
        driverId: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [];
    if (data?.driverId) {
      conditions.push(eq(driverTrips.driverId, data.driverId));
    }
    if (data?.fromDate) {
      conditions.push(gte(driverTrips.tripDate, new Date(data.fromDate)));
    }
    if (data?.toDate) {
      const to = new Date(data.toDate);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(driverTrips.tripDate, to));
    }

    return await db.query.driverTrips.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        driver: true,
        recordedBy: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [desc(driverTrips.tripDate)],
    });
  });

export const createDriverTripFn = createServerFn()
  .middleware([requireSalesPeopleManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        driverId: z.string().min(1, "Driver is required"),
        tripDate: z.string().or(z.date()),
        destination: z.string().min(1, "Destination is required"),
        vehicleNumber: z.string().optional(),
        distanceKm: z.number().nonnegative("Distance must be non-negative"),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.authContext?.session?.user?.id;

    return await db.transaction(async (tx) => {
      // Query system-wide active TA/DA rate from sales/configuration
      const activeRate = await tx.query.tadaRates.findFirst({
        where: eq(tadaRates.isActive, true),
        orderBy: [desc(tadaRates.effectiveFrom)],
      });

      if (!activeRate) {
        throw new Error(
          "No active system TA/DA rate found. Please configure a TA/DA rate in Sales > Configurations.",
        );
      }

      const ratePerKm = parseFloat(activeRate.ratePerKm);
      const tadaAmount = (data.distanceKm * ratePerKm).toFixed(2);

      const tripDate =
        typeof data.tripDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(data.tripDate)
          ? new Date(`${data.tripDate}T12:00:00+05:00`)
          : new Date(data.tripDate);

      const [inserted] = await tx
        .insert(driverTrips)
        .values({
          driverId: data.driverId,
          tripDate,
          destination: data.destination,
          vehicleNumber: data.vehicleNumber?.trim() || null,
          distanceKm: data.distanceKm.toFixed(2),
          ratePerKm: ratePerKm.toFixed(2),
          tadaAmount,
          notes: data.notes?.trim() || null,
          recordedById: userId,
        })
        .returning();

      // Auto-sync attendance for that business date
      const businessDate = toPKTDate(tripDate);
      await syncDriverAttendanceForDate({
        tx,
        driverId: data.driverId,
        businessDate,
      });

      return inserted;
    });
  });

export const deleteDriverTripFn = createServerFn()
  .middleware([requireSalesPeopleManageMiddleware])
  .inputValidator((input: any) =>
    z.object({ id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const existing = await tx.query.driverTrips.findFirst({
        where: eq(driverTrips.id, data.id),
      });

      if (!existing) {
        throw new Error("Driver trip not found");
      }

      const businessDate = toPKTDate(existing.tripDate);
      const driverId = existing.driverId;

      await tx.delete(driverTrips).where(eq(driverTrips.id, data.id));

      await syncDriverAttendanceForDate({
        tx,
        driverId,
        businessDate,
      });

      return { success: true };
    });
  });
