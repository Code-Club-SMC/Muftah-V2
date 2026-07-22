import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { orders, orderItems, orderBookerTrips, commissionRecords, payments } from "@/db/schemas/sales-erp-schema";
import { orderBookers } from "@/db/schemas/sales-erp-schema";
import { invoices, customers } from "@/db/schemas/sales-schema";
import { tadaRates } from "@/db/schemas/hr-schema";
import { eq, and, gte, lte, desc, ilike, or, sql, gt } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import {
  requireOrderBookerViewMiddleware,
  requireOrderBookerOrdersManageMiddleware,
  requireOrderBookerTripsManageMiddleware,
  requireOrderBookerRecoveriesManageMiddleware,
} from "@/lib/middlewares";
import { createOrderSchema } from "@/db/zod_schemas";
import { AppError, InternalError } from "@/lib/errors";
import {
  MAX_BILL_NUMBER_RETRIES,
  allocateNextBillNumberInTx,
  isOrderBillNumberUniqueViolation,
} from "./order-bill-number";

// ═══════════════════════════════════════════════════════════════════════════
// ORDER BOOKER SELF-SERVICE
// All functions look up the order booker by session.user.id via userId link.
// ═══════════════════════════════════════════════════════════════════════════

const ORDER_BOOKER_PROFILE_REQUIRED = "ORDER_BOOKER_PROFILE_REQUIRED";
const ORDER_BOOKER_PROFILE_INACTIVE = "ORDER_BOOKER_PROFILE_INACTIVE";
const ORDER_BOOKER_EMPLOYEE_INACTIVE = "ORDER_BOOKER_EMPLOYEE_INACTIVE";

type OrderBookerProfile = NonNullable<
  Awaited<ReturnType<typeof db.query.orderBookers.findFirst>>
>;

type OrderBookerPortalAccess =
  | {
      allowed: true;
      profile: OrderBookerProfile;
    }
  | {
      allowed: false;
      reason:
        | typeof ORDER_BOOKER_PROFILE_REQUIRED
        | typeof ORDER_BOOKER_PROFILE_INACTIVE
        | typeof ORDER_BOOKER_EMPLOYEE_INACTIVE;
      message: string;
    };

async function getOrderBookerPortalAccess(session: any): Promise<OrderBookerPortalAccess> {
  if (!session?.user?.id) {
    throw new InternalError("Unable to verify the current account.");
  }

  try {
    const ob = await db.query.orderBookers.findFirst({
      where: eq(orderBookers.userId, session.user.id),
    });

    if (!ob) {
      return {
        allowed: false,
        reason: ORDER_BOOKER_PROFILE_REQUIRED,
        message: "This account is not linked to an order booker profile.",
      };
    }

    if (ob.status !== "active") {
      return {
        allowed: false,
        reason: ORDER_BOOKER_PROFILE_INACTIVE,
        message: "This order booker profile is inactive. Contact an administrator.",
      };
    }

    if (ob.employeeId) {
      const employee = await db.query.employees.findFirst({
        where: (employee, { eq }) => eq(employee.id, ob.employeeId!),
        columns: {
          status: true,
        },
      });

      if (!employee || employee.status !== "active") {
        return {
          allowed: false,
          reason: ORDER_BOOKER_EMPLOYEE_INACTIVE,
          message:
            "Order booker portal requires an active employee profile. Contact HR.",
        };
      }
    }

    return {
      allowed: true,
      profile: ob,
    };
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("[getOrderBookerPortalAccess] DB error:", error);
      throw new InternalError("Failed to verify your account. Please try again.");
    }

    throw error;
  }
}

async function requireOrderBookerFromSession(session: any) {
  const portalAccess = await getOrderBookerPortalAccess(session);

  if (!portalAccess.allowed) {
    throw new AppError(portalAccess.message, portalAccess.reason, 403);
  }

  return portalAccess.profile;
}

export const getOrderBookerPortalAccessFn = createServerFn()
  .middleware([requireOrderBookerViewMiddleware])
  .handler(async ({ context }) => {
    return getOrderBookerPortalAccess(context.session);
  });

// ---------------------------------------------------------------------------
// Orders — Paginated with filters
// ---------------------------------------------------------------------------

export const getMyOrdersFn = createServerFn()
  .middleware([requireOrderBookerViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(["pending", "confirmed", "delivered", "returned"]).optional(),
        search: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);

    const conditions: any[] = [eq(orders.orderBookerId, ob.id)];
    if (data.status) conditions.push(eq(orders.status, data.status));
    if (data.fromDate) conditions.push(gte(orders.createdAt, new Date(data.fromDate)));
    if (data.toDate) conditions.push(lte(orders.createdAt, new Date(data.toDate)));
    if (data.search) {
      const safeSearch = data.search.replace(/[%_]/g, "");
      if (safeSearch) {
        conditions.push(
          or(
            ilike(orders.shopkeeperName, `%${safeSearch}%`),
            ilike(orders.shopkeeperMobile, `%${safeSearch}%`),
          ),
        );
      }
    }

    const whereClause = and(...conditions);
    const limit = data.limit;
    const offset = (data.page - 1) * limit;

    const [totalRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(whereClause),
      db.query.orders.findMany({
        where: whereClause,
        orderBy: [desc(orders.createdAt)],
        limit,
        offset,
        with: {
          items: { with: { product: true } },
        },
      }),
    ]);

    return {
      data: rows,
      meta: {
        total: totalRes[0]?.count ?? 0,
        page: data.page,
        limit,
        totalPages: Math.ceil((totalRes[0]?.count ?? 0) / limit),
      },
    };
  });

export const createMyOrderFn = createServerFn()
  .middleware([requireOrderBookerOrdersManageMiddleware])
  .inputValidator((input: any) => createOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);
    const { items, trip: _trip, ...rest } = data;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_BILL_NUMBER_RETRIES; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          const billNumber = await allocateNextBillNumberInTx(tx, ob.id);

          const [order] = await tx
            .insert(orders)
            .values({
              ...rest,
              orderBookerId: ob.id,
              billNumber,
              status: "pending",
            })
            .returning();

          if (items?.length) {
            await tx.insert(orderItems).values(
              items.map((item) => ({
                orderId: order.id,
                productId: item.productId,
                recipeId: item.recipeId,
                unitType: item.unitType,
                quantity: item.quantity,
                rate: String(item.rate),
                amount: String(item.quantity * item.rate),
              })),
            );
          }

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

// ---------------------------------------------------------------------------
// Trips — Paginated with filters
// ---------------------------------------------------------------------------

const tripVehicleTypeSchema = z.enum(["own", "company", "own_vehicle", "company_vehicle"]);

export const getMyTripsFn = createServerFn()
  .middleware([requireOrderBookerViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        vehicleType: tripVehicleTypeSchema.optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);

    const conditions: any[] = [eq(orderBookerTrips.orderBookerId, ob.id)];
    if (data.fromDate) conditions.push(gte(orderBookerTrips.tripDate, new Date(data.fromDate)));
    if (data.toDate) conditions.push(lte(orderBookerTrips.tripDate, new Date(data.toDate)));
    if (data.vehicleType) {
      const vt = data.vehicleType;
      const dbValue = vt === "own" ? "own_vehicle" : vt === "company" ? "company_vehicle" : vt;
      conditions.push(eq(orderBookerTrips.vehicleType, dbValue));
    }

    const whereClause = and(...conditions);
    const limit = data.limit;
    const offset = (data.page - 1) * limit;

    const [totalRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orderBookerTrips)
        .where(whereClause),
      db.query.orderBookerTrips.findMany({
        where: whereClause,
        orderBy: [desc(orderBookerTrips.tripDate)],
        limit,
        offset,
      }),
    ]);

    return {
      data: rows,
      meta: {
        total: totalRes[0]?.count ?? 0,
        page: data.page,
        limit,
        totalPages: Math.ceil((totalRes[0]?.count ?? 0) / limit),
      },
    };
  });

const createTripInputSchema = z.object({
  date: z.string().min(1, "Date is required"),
  areaVisited: z.string().min(1, "Area visited is required"),
  distanceKm: z.number().positive("Distance must be greater than 0"),
  vehicleType: tripVehicleTypeSchema,
  fuelCost: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const createMyTripFn = createServerFn()
  .middleware([requireOrderBookerTripsManageMiddleware])
  .inputValidator((input: any) => createTripInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);

    const activeRate = await db.query.tadaRates.findFirst({
      where: eq(tadaRates.isActive, true),
      orderBy: [desc(tadaRates.effectiveFrom)],
    });

    const tadaAmount = activeRate ? data.distanceKm * Number(activeRate.ratePerKm) : 0;

    const vt = data.vehicleType;
    const dbVehicleType = vt === "own" ? "own_vehicle" : vt === "company" ? "company_vehicle" : vt;

    const [trip] = await db
      .insert(orderBookerTrips)
      .values({
        orderBookerId: ob.id,
        tripDate: new Date(data.date),
        destination: data.areaVisited,
          distanceKm: String(data.distanceKm),
        vehicleType: dbVehicleType,
        fuelCost: dbVehicleType === "own_vehicle" ? String(data.fuelCost || 0) : "0",
        tadaAmount: String(tadaAmount),
        notes: data.notes ?? null,
      })
      .returning();

    return trip;
  });

// ---------------------------------------------------------------------------
// Commission — Paginated with filters
// ---------------------------------------------------------------------------

export const getMyCommissionFn = createServerFn()
  .middleware([requireOrderBookerViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(["accrued", "paid", "reversed"]).optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);

    const conditions: any[] = [eq(commissionRecords.orderBookerId, ob.id)];
    if (data.status) conditions.push(eq(commissionRecords.status, data.status));
    if (data.fromDate) conditions.push(gte(commissionRecords.createdAt, new Date(data.fromDate)));
    if (data.toDate) conditions.push(lte(commissionRecords.createdAt, new Date(data.toDate)));

    const whereClause = and(...conditions);
    const limit = data.limit;
    const offset = (data.page - 1) * limit;

    const [totalRes, records, summaryResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(commissionRecords)
        .where(whereClause),
      db.query.commissionRecords.findMany({
        where: whereClause,
        orderBy: [desc(commissionRecords.createdAt)],
        limit,
        offset,
        with: {
          order: { columns: { billNumber: true, shopkeeperName: true } },
        },
      }),
      db
        .select({
          totalAccrued: sql<number>`COALESCE(SUM(CASE WHEN ${commissionRecords.status} = 'accrued' THEN ${commissionRecords.commissionAmount} ELSE 0 END), 0)`,
          totalPaid: sql<number>`COALESCE(SUM(CASE WHEN ${commissionRecords.status} = 'paid' THEN ${commissionRecords.commissionAmount} ELSE 0 END), 0)`,
          totalReversed: sql<number>`COALESCE(SUM(CASE WHEN ${commissionRecords.status} = 'reversed' THEN ${commissionRecords.commissionAmount} ELSE 0 END), 0)`,
        })
        .from(commissionRecords)
        .where(whereClause),
    ]);

    const summary = {
      totalAccrued: Number(summaryResult[0]?.totalAccrued ?? 0),
      totalPaid: Number(summaryResult[0]?.totalPaid ?? 0),
      totalReversed: Number(summaryResult[0]?.totalReversed ?? 0),
    };

    return {
      data: records,
      summary,
      meta: {
        total: totalRes[0]?.count ?? 0,
        page: data.page,
        limit,
        totalPages: Math.ceil((totalRes[0]?.count ?? 0) / limit),
      },
    };
  });

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const getMyProfileFn = createServerFn()
  .middleware([requireOrderBookerViewMiddleware])
  .handler(async ({ context }) => {
    const ob = await requireOrderBookerFromSession(context.session);
    return ob;
  });

// ---------------------------------------------------------------------------
// Recoveries — outstanding invoices booked by this order booker
// ---------------------------------------------------------------------------

export const getMyRecoveriesFn = createServerFn()
  .middleware([requireOrderBookerViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(["outstanding", "paid", "all"]).default("outstanding"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);

    const conditions: any[] = [eq(invoices.orderBookerId, ob.id)];

    if (data.status === "outstanding") {
      conditions.push(gt(invoices.credit, "0"));
    } else if (data.status === "paid") {
      conditions.push(eq(invoices.credit, "0"));
    }

    const whereClause = and(...conditions);
    const limit = data.limit;
    const offset = (data.page - 1) * limit;

    const [totalRes, rows, summaryResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(whereClause),
      db.query.invoices.findMany({
        where: whereClause,
        orderBy: [desc(invoices.date)],
        limit,
        offset,
        with: {
          customer: { columns: { id: true, name: true, mobileNumber: true } },
          order: { columns: { id: true, billNumber: true, shopkeeperName: true } },
        },
      }),
      db
        .select({
          totalOutstanding: sql<number>`COALESCE(SUM(${invoices.credit}), 0)`,
          totalCollected: sql<number>`COALESCE(SUM(${invoices.cash}), 0)`,
        })
        .from(invoices)
        .where(and(eq(invoices.orderBookerId, ob.id), gt(invoices.credit, "0"))),
    ]);

    return {
      data: rows,
      summary: {
        totalOutstanding: Number(summaryResult[0]?.totalOutstanding ?? 0),
        totalCollected: Number(summaryResult[0]?.totalCollected ?? 0),
        count: Number(totalRes[0]?.count ?? 0),
      },
      meta: {
        total: totalRes[0]?.count ?? 0,
        page: data.page,
        limit,
        totalPages: Math.ceil((totalRes[0]?.count ?? 0) / limit),
      },
    };
  });

export const recordMyRecoveryFn = createServerFn()
  .middleware([requireOrderBookerRecoveriesManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        invoiceId: z.string().min(1, "Invoice is required"),
        amount: z.number().positive("Amount must be greater than 0"),
        method: z.enum(["cash", "bank_transfer"]).default("cash"),
        reference: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ob = await requireOrderBookerFromSession(context.session);
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      // 1. Verify the invoice belongs to this order booker
      const invoice = await tx.query.invoices.findFirst({
        where: and(
          eq(invoices.id, data.invoiceId),
          eq(invoices.orderBookerId, ob.id),
        ),
        with: { customer: true },
      });

      if (!invoice) {
        throw new AppError(
          "Invoice not found or does not belong to your orders.",
          "ORDER_BOOKER_INVOICE_NOT_FOUND",
          404,
        );
      }

      const outstanding = Number(invoice.credit);
      if (outstanding <= 0) {
        throw new AppError(
          "This invoice has no outstanding balance.",
          "INVOICE_NOT_OUTSTANDING",
          400,
        );
      }

      if (data.amount > outstanding) {
        throw new AppError(
          `Recovery amount (${data.amount}) cannot exceed outstanding balance (${outstanding}).`,
          "RECOVERY_AMOUNT_EXCEEDS_OUTSTANDING",
          400,
        );
      }

      // 2. Insert payment record
      const [payment] = await tx
        .insert(payments)
        .values({
          id: createId(),
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          amount: data.amount.toString(),
          method: data.method,
          reference: data.reference,
          notes: data.notes ?? `Recovery by order booker: ${ob.name}`,
          recordedById: userId,
          paymentDate: new Date(),
        })
        .returning();

      // 3. Update customer ledger
      await tx
        .update(customers)
        .set({
          payment: sql`${customers.payment} + ${data.amount}`,
          credit: sql`${customers.credit} - ${data.amount}`,
        })
        .where(eq(customers.id, invoice.customerId));

      // 4. Update invoice credit + status
      const newCredit = Math.max(0, outstanding - data.amount);
      const newStatus = newCredit === 0 ? "paid" : "partially_paid";

      await tx
        .update(invoices)
        .set({
          credit: newCredit.toString(),
          cash: sql`${invoices.cash} + ${data.amount}`,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id));

      return {
        payment,
        invoiceId: invoice.id,
        remainingOutstanding: newCredit,
        newStatus,
      };
    });
  });
