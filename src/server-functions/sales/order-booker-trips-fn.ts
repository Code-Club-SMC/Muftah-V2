import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { orderBookerTrips } from "@/db/schemas/sales-erp-schema";
import { tadaRates } from "@/db/schemas/hr-schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { z } from "zod";
import {
  requireSalesPeopleViewMiddleware,
  requireSalesPeopleManageMiddleware,
} from "@/lib/middlewares";
import {
  assertOrderBookerTripAllowed,
  resolveOrderBookerTripEligibility,
} from "./order-booker-trip-day-state";
import { syncOrderBookerAttendanceForDate } from "./order-booker-trip-sync";

// ═══════════════════════════════════════════════════════════════════════════
// ORDER BOOKER TRIPS
// ═══════════════════════════════════════════════════════════════════════════

export const getOrderBookerTripsFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        orderBookerId: z.string(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [eq(orderBookerTrips.orderBookerId, data.orderBookerId)];
    if (data.fromDate) {
      conditions.push(gte(orderBookerTrips.tripDate, new Date(data.fromDate)));
    }
    if (data.toDate) {
      conditions.push(lte(orderBookerTrips.tripDate, new Date(data.toDate)));
    }
    return await db.query.orderBookerTrips.findMany({
      where: and(...conditions),
      orderBy: [desc(orderBookerTrips.tripDate)],
    });
  });

export const createOrderBookerTripFn = createServerFn()
  .middleware([requireSalesPeopleManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        orderBookerId: z.string(),
        tripDate: z.string().or(z.date()),
        destination: z.string().min(1),
        shopType: z.enum(["old", "new"]),
        distanceKm: z.number().nonnegative(),
        vehicleType: z.enum(["own_vehicle", "company_vehicle"]).default("own_vehicle"),
        fuelCost: z.number().nonnegative().default(0),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.authContext?.session?.user?.id;

    return await db.transaction(async (tx) => {
      const eligibility = await resolveOrderBookerTripEligibility({
        tx,
        orderBookerId: data.orderBookerId,
        tripDate: data.tripDate,
      });
      assertOrderBookerTripAllowed(eligibility);

      // Get active TADA rate
      const activeRate = await tx.query.tadaRates.findFirst({
        where: eq(tadaRates.isActive, true),
        orderBy: [desc(tadaRates.effectiveFrom)],
      });

      const ratePerKm = activeRate ? parseFloat(activeRate.ratePerKm) : 0;
      const tadaAmount = data.distanceKm * ratePerKm;

      const [inserted] = await tx
        .insert(orderBookerTrips)
        .values({
          orderBookerId: data.orderBookerId,
          tripDate: new Date(data.tripDate),
          destination: data.destination,
          shopType: data.shopType,
          distanceKm: data.distanceKm.toString(),
          vehicleType: data.vehicleType,
          fuelCost: data.vehicleType === "company_vehicle" ? "0" : data.fuelCost.toString(),
          tadaAmount: tadaAmount.toString(),
          notes: data.notes,
          recordedById: userId,
        })
        .returning();

      await syncOrderBookerAttendanceForDate({
        tx,
        employeeId: eligibility.employeeId,
        orderBookerId: eligibility.orderBookerId,
        businessDate: eligibility.businessDate,
        standardDutyHours: eligibility.standardDutyHours,
      });

      return inserted;
    });
  });

export const updateOrderBookerTripFn = createServerFn()
  .middleware([requireSalesPeopleManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        id: z.string(),
        tripDate: z.string().or(z.date()).optional(),
        destination: z.string().min(1).optional(),
        shopType: z.enum(["old", "new"]).optional(),
        distanceKm: z.number().nonnegative().optional(),
        vehicleType: z.enum(["own_vehicle", "company_vehicle"]).optional(),
        fuelCost: z.number().nonnegative().optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;

    return await db.transaction(async (tx) => {
      // Fetch existing to know current date and vehicle type.
      const existing = await tx.query.orderBookerTrips.findFirst({
        where: eq(orderBookerTrips.id, id),
      });
      if (!existing) throw new Error("Trip not found");

      const oldEligibility = await resolveOrderBookerTripEligibility({
        tx,
        orderBookerId: existing.orderBookerId,
        tripDate: existing.tripDate,
        excludeTripId: id,
      });

      const targetTripDate = updates.tripDate ?? existing.tripDate;
      const newEligibility = await resolveOrderBookerTripEligibility({
        tx,
        orderBookerId: existing.orderBookerId,
        tripDate: targetTripDate,
        excludeTripId: id,
      });
      assertOrderBookerTripAllowed(newEligibility);

      const updateValues: any = {};

      if (updates.tripDate !== undefined) updateValues.tripDate = new Date(updates.tripDate);
      if (updates.destination !== undefined) updateValues.destination = updates.destination;
      if (updates.shopType !== undefined) updateValues.shopType = updates.shopType;
      if (updates.distanceKm !== undefined) {
        updateValues.distanceKm = updates.distanceKm.toString();
        // Recalculate TADA
        const activeRate = await tx.query.tadaRates.findFirst({
          where: eq(tadaRates.isActive, true),
          orderBy: [desc(tadaRates.effectiveFrom)],
        });
        const ratePerKm = activeRate ? parseFloat(activeRate.ratePerKm) : 0;
        updateValues.tadaAmount = (updates.distanceKm * ratePerKm).toString();
      }
      if (updates.vehicleType !== undefined) {
        updateValues.vehicleType = updates.vehicleType;
        if (updates.vehicleType === "company_vehicle") updateValues.fuelCost = "0";
      }
      const effectiveVehicleType = updateValues.vehicleType || existing.vehicleType;
      if (updates.fuelCost !== undefined && effectiveVehicleType !== "company_vehicle") {
        updateValues.fuelCost = updates.fuelCost.toString();
      }
      if (updates.notes !== undefined) updateValues.notes = updates.notes;
      updateValues.updatedAt = new Date();

      const [updated] = await tx
        .update(orderBookerTrips)
        .set(updateValues)
        .where(eq(orderBookerTrips.id, id))
        .returning();

      await syncOrderBookerAttendanceForDate({
        tx,
        employeeId: oldEligibility.employeeId,
        orderBookerId: oldEligibility.orderBookerId,
        businessDate: oldEligibility.businessDate,
        standardDutyHours: oldEligibility.standardDutyHours,
      });

      if (newEligibility.businessDate !== oldEligibility.businessDate) {
        await syncOrderBookerAttendanceForDate({
          tx,
          employeeId: newEligibility.employeeId,
          orderBookerId: newEligibility.orderBookerId,
          businessDate: newEligibility.businessDate,
          standardDutyHours: newEligibility.standardDutyHours,
        });
      }

      return updated;
    });
  });

export const deleteOrderBookerTripFn = createServerFn()
  .middleware([requireSalesPeopleManageMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      const existing = await tx.query.orderBookerTrips.findFirst({
        where: eq(orderBookerTrips.id, data.id),
      });
      if (!existing) throw new Error("Trip not found");

      const eligibility = await resolveOrderBookerTripEligibility({
        tx,
        orderBookerId: existing.orderBookerId,
        tripDate: existing.tripDate,
        excludeTripId: existing.id,
      });

      await tx.delete(orderBookerTrips).where(eq(orderBookerTrips.id, data.id));

      await syncOrderBookerAttendanceForDate({
        tx,
        employeeId: eligibility.employeeId,
        orderBookerId: eligibility.orderBookerId,
        businessDate: eligibility.businessDate,
        standardDutyHours: eligibility.standardDutyHours,
      });
    });
    return { success: true };
  });

export const getTadaRateFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .handler(async () => {
    const rate = await db.query.tadaRates.findFirst({
      where: eq(tadaRates.isActive, true),
      orderBy: [desc(tadaRates.effectiveFrom)],
    });
    return rate ?? null;
  });
