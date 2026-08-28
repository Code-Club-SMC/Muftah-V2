import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { orders, orderItems, commissionRecords, salesmen, orderBookerTrips } from "@/db/schemas/sales-erp-schema";
import { customers } from "@/db/schemas/sales-schema";
import { tadaRates } from "@/db/schemas/hr-schema";
import { eq, and, gte, lte, desc, or, ilike } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import {
  requireSalesOrdersViewMiddleware,
  requireSalesOrdersManageMiddleware,
} from "@/lib/middlewares";
import { calculateCommissionForOrder } from "./order-booker-commission-calc";
import {
  MAX_BILL_NUMBER_RETRIES,
  allocateNextBillNumberInTx,
  isOrderBillNumberUniqueViolation,
} from "./order-bill-number";
import {
  assertOrderBookerTripAllowed,
  resolveOrderBookerTripEligibility,
} from "./order-booker-trip-day-state";
import { syncOrderBookerAttendanceForDate } from "./order-booker-trip-sync";
import { logActivityQuiet } from "@/lib/activity-logger.server";


// ═══════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════

export const getOrdersFn = createServerFn()
  .middleware([requireSalesOrdersViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        status: z.enum(["pending", "confirmed", "delivered", "returned"]).optional(),
        orderBookerId: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [];
    if (data.status) conditions.push(eq(orders.status, data.status));
    if (data.orderBookerId) conditions.push(eq(orders.orderBookerId, data.orderBookerId));
    if (data.fromDate) conditions.push(gte(orders.createdAt, new Date(data.fromDate)));
    if (data.toDate) conditions.push(lte(orders.createdAt, new Date(data.toDate)));

    return await db.query.orders.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(orders.createdAt)],
      with: {
        orderBooker: true,
        items: { with: { product: true } },
      },
    });
  });

export const getOrderDetailFn = createServerFn()
  .middleware([requireSalesOrdersViewMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, data.id),
      with: {
        orderBooker: true,
        fulfilledBySalesman: true,
        trip: true,
        items: { with: { product: true } },
      },
    });
    if (!order) throw new Error("Order not found");
    return order;
  });

export const createOrderFn = createServerFn()
  .middleware([requireSalesOrdersManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        orderBookerId: z.string().min(1),
        shopkeeperName: z.string().min(1),
        shopkeeperMobile: z.string().optional(),
        shopkeeperAddress: z.string().optional(),
        // Optional trip details. When provided, a trip is created and linked to the order.
        trip: z
          .object({
            tripDate: z.string().or(z.date()),
            destination: z.string().min(1),
            shopType: z.enum(["old", "new"]),
            distanceKm: z.number().nonnegative(),
            vehicleType: z.enum(["own_vehicle", "company_vehicle"]).default("own_vehicle"),
            fuelCost: z.number().nonnegative().default(0),
            notes: z.string().optional(),
          })
          .optional(),
        items: z.array(
          z.object({
            productId: z.string().min(1),
            recipeId: z.string().optional(),
            unitType: z.string().min(1).default("full_carton"),
            quantity: z.number().int().positive(),
            rate: z.number().nonnegative(),
          }),
        ).min(1),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_BILL_NUMBER_RETRIES; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          let tripId: string | undefined;

          // Create associated trip when trip details are supplied.
          if (data.trip) {
            const eligibility = await resolveOrderBookerTripEligibility({
              tx,
              orderBookerId: data.orderBookerId,
              tripDate: data.trip.tripDate,
            });
            assertOrderBookerTripAllowed(eligibility);

            const activeRate = await tx.query.tadaRates.findFirst({
              where: eq(tadaRates.isActive, true),
              orderBy: [desc(tadaRates.effectiveFrom)],
            });
            const ratePerKm = activeRate ? parseFloat(activeRate.ratePerKm) : 0;
            const tadaAmount = data.trip.distanceKm * ratePerKm;

            const [trip] = await tx
              .insert(orderBookerTrips)
              .values({
                id: createId(),
                orderBookerId: data.orderBookerId,
                tripDate: new Date(data.trip.tripDate),
                destination: data.trip.destination,
                shopType: data.trip.shopType,
                distanceKm: data.trip.distanceKm.toString(),
                vehicleType: data.trip.vehicleType,
                fuelCost:
                  data.trip.vehicleType === "company_vehicle"
                    ? "0"
                    : data.trip.fuelCost.toString(),
                tadaAmount: tadaAmount.toString(),
                notes: data.trip.notes,
                recordedById: context.authContext?.session?.user?.id,
              })
              .returning();

            tripId = trip.id;

            await syncOrderBookerAttendanceForDate({
              tx,
              employeeId: eligibility.employeeId,
              orderBookerId: eligibility.orderBookerId,
              businessDate: eligibility.businessDate,
              standardDutyHours: eligibility.standardDutyHours,
            });
          }

          const billNumber = await allocateNextBillNumberInTx(
            tx,
            data.orderBookerId,
          );

          const [order] = await tx
            .insert(orders)
            .values({
              orderBookerId: data.orderBookerId,
              billNumber,
              shopkeeperName: data.shopkeeperName,
              shopkeeperMobile: data.shopkeeperMobile,
              shopkeeperAddress: data.shopkeeperAddress,
              tripId,
              status: "pending",
              notes: data.notes,
            })
            .returning();

          await tx.insert(orderItems).values(
            data.items.map((item) => ({
              orderId: order.id,
              productId: item.productId,
              recipeId: item.recipeId,
              unitType: item.unitType,
              quantity: item.quantity,
              rate: item.rate.toString(),
              amount: (item.quantity * item.rate).toString(),
            })),
          );

          logActivityQuiet({
            module: "sales",
            action: "created",
            entityType: "order",
            entityId: order.id,
            entityLabel: String(order.billNumber),
            actorId: context.authContext.session.user.id,
            actorName: context.authContext.session.user.name,
            description: `Created order ${order.billNumber} for ${order.shopkeeperName}`,
          });

          return order;
        });
      } catch (error) {
        if (
          attempt < MAX_BILL_NUMBER_RETRIES - 1 &&
          isOrderBillNumberUniqueViolation(error)
        ) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new Error("Failed to allocate order bill number.");
  });

export const updateOrderFn = createServerFn()
  .middleware([requireSalesOrdersManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        id: z.string(),
        shopkeeperName: z.string().min(1).optional(),
        shopkeeperMobile: z.string().optional(),
        shopkeeperAddress: z.string().optional(),
        tripId: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const updateValues: any = {};
    if (updates.shopkeeperName !== undefined) updateValues.shopkeeperName = updates.shopkeeperName;
    if (updates.shopkeeperMobile !== undefined) updateValues.shopkeeperMobile = updates.shopkeeperMobile;
    if (updates.shopkeeperAddress !== undefined) updateValues.shopkeeperAddress = updates.shopkeeperAddress;
    if (updates.tripId !== undefined) updateValues.tripId = updates.tripId;
    if (updates.notes !== undefined) updateValues.notes = updates.notes;
    updateValues.updatedAt = new Date();

    const [updated] = await db
      .update(orders)
      .set(updateValues)
      .where(eq(orders.id, id))
      .returning();
    return updated;
  });

export const deleteOrderFn = createServerFn()
  .middleware([requireSalesOrdersManageMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      await tx.delete(commissionRecords).where(eq(commissionRecords.orderId, data.id));
      await tx.delete(orderItems).where(eq(orderItems.orderId, data.id));
      await tx.delete(orders).where(eq(orders.id, data.id));
    });
    return { success: true };
  });

export const fulfillOrderFn = createServerFn()
  .middleware([requireSalesOrdersManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        id: z.string(),
        fulfilledBySalesmanId: z.string().min(1),
        fulfilledAmount: z.number().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, data.id),
      with: { items: true },
    });
    if (!order) throw new Error("Order not found");
    if (order.status === "delivered") throw new Error("Order already fulfilled");

    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.id, data.fulfilledBySalesmanId),
    });
    if (!salesman) throw new Error("Salesman not found");
    if (salesman.status !== "active") throw new Error("Salesman is not active");

    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(orders)
        .set({
          status: "delivered",
          fulfilledBySalesmanId: data.fulfilledBySalesmanId,
          fulfilledAt: new Date(),
          fulfilledAmount: data.fulfilledAmount.toString(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, data.id))
        .returning();

      // Calculate commission within same transaction
      await calculateCommissionForOrder(
        tx as any,
        order.orderBookerId,
        order.id,
        data.fulfilledAmount,
      );

      logActivityQuiet({
        module: "sales",
        action: "fulfilled",
        entityType: "order",
        entityId: updated.id,
        entityLabel: String(updated.billNumber),
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Fulfilled order ${updated.billNumber}`,
      });

      return updated;
    });
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET ORDER FOR INVOICE CONVERSION
// Returns the order with items, resolved customer (find-or-create by mobile),
// and recipe details so the invoice form can be pre-filled.
// ═══════════════════════════════════════════════════════════════════════════

export const getOrderForInvoiceFn = createServerFn()
  .middleware([requireSalesOrdersViewMiddleware])
  .inputValidator((input: any) => z.object({ orderId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, data.orderId),
      with: {
        orderBooker: true,
        items: {
          with: {
            product: true,
            recipe: {
              columns: {
                id: true,
                name: true,
                cartonPackagingId: true,
                containersPerCarton: true,
                estimatedCostPerContainer: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw new Error("Order not found");

    // Find-or-create a customer matching the shopkeeper.
    // Match by mobile number first (most reliable), then by name.
    let customer: typeof customers.$inferSelect | null = null;

    if (order.shopkeeperMobile) {
      customer = (await db.query.customers.findFirst({
        where: ilike(customers.mobileNumber, order.shopkeeperMobile),
      })) ?? null;
    }

    if (!customer && order.shopkeeperName) {
      customer = (await db.query.customers.findFirst({
        where: and(
          eq(customers.name, order.shopkeeperName),
          or(
            eq(customers.customerType, "shopkeeper"),
            eq(customers.customerType, "retailer"),
          ),
        ),
      })) ?? null;
    }

    // If no customer found, we return a flag so the UI can create one inline
    // via the invoice form's "new customer" mode.
    const resolvedCustomer = customer
      ? { found: true as const, ...customer }
      : {
          found: false as const,
          name: order.shopkeeperName,
          mobileNumber: order.shopkeeperMobile ?? null,
          address: order.shopkeeperAddress ?? null,
          customerType: "shopkeeper" as const,
        };

    return {
      order: {
        id: order.id,
        billNumber: order.billNumber,
        orderBookerId: order.orderBookerId,
        orderBookerName: order.orderBooker?.name ?? null,
        shopkeeperName: order.shopkeeperName,
        shopkeeperMobile: order.shopkeeperMobile,
        shopkeeperAddress: order.shopkeeperAddress,
        status: order.status,
      },
      customer: resolvedCustomer,
      items: order.items.map((item) => ({
        productId: item.productId,
        recipeId: item.recipeId ?? null,
        productName: item.product?.name ?? "",
        recipeName: item.recipe?.name ?? "",
        hasCartonPackaging:
          Boolean(item.recipe?.cartonPackagingId) &&
          Number(item.recipe?.containersPerCarton ?? 0) > 0,
        containersPerCarton: item.recipe?.containersPerCarton ?? null,
        unitType: item.unitType,
        quantity: item.quantity,
        rate: Number(item.rate),
        amount: Number(item.amount),
      })),
    };
  });
