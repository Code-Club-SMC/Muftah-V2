import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  salesmen,
  orderBookers,
  recipePrices,
} from "@/db/schemas/sales-erp-schema";
import { recipes } from "@/db/schemas/inventory-schema";
import { user } from "@/db/schemas/auth-schema";
import { customers, invoices, invoiceItems } from "@/db/schemas/sales-schema";
import {
  requireSalesViewMiddleware,
  requireSalesManageMiddleware,
  requireSalesConfigViewMiddleware,
  requireSalesConfigManageMiddleware,
} from "@/lib/middlewares";
import {
  createOrderBookerSchema,
  updateOrderBookerSchema,
} from "@/db/zod_schemas";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import {
  eq,
  desc,
  and,
  gte,
  lte,
  inArray,
  ne,
  sum,
  count,
  sql,
} from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// SALESMEN (extended fields)
// ═══════════════════════════════════════════════════════════════════════════

export const getSalesmenFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .handler(async () => {
    return await db.query.salesmen.findMany({
      orderBy: [desc(salesmen.createdAt)],
    });
  });

export const createSalesmanFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        name: z.string().min(1),
        phone: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const [inserted] = await db
      .insert(salesmen)
      .values({
        name: data.name,
        phone: data.phone,
      })
      .returning();
    return inserted;
  });

export const updateSalesmanFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        status: z.enum(["active", "inactive"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const updateValues: any = {};
    if (updates.name !== undefined) updateValues.name = updates.name;
    if (updates.phone !== undefined) updateValues.phone = updates.phone;
    if (updates.status !== undefined) updateValues.status = updates.status;

    const [updated] = await db
      .update(salesmen)
      .set(updateValues)
      .where(eq(salesmen.id, id))
      .returning();
    return updated;
  });

// ═══════════════════════════════════════════════════════════════════════════
// ORDER BOOKERS
// ═══════════════════════════════════════════════════════════════════════════

export const getOrderBookersFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        status: z.enum(["active", "inactive"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    return await db.query.orderBookers.findMany({
      where: data.status ? eq(orderBookers.status, data.status) : undefined,
      orderBy: [desc(orderBookers.createdAt)],
    });
  });

export const getOrderBookerDetailFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const orderBooker = await db.query.orderBookers.findFirst({
      where: eq(orderBookers.id, data.id),
    });
    if (!orderBooker) throw new Error("Order booker not found");
    return orderBooker;
  });

export const createOrderBookerFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => createOrderBookerSchema.parse(input))
  .handler(async ({ data }) => {
    const [inserted] = await db
      .insert(orderBookers)
      .values({
        name: data.name,
        phone: data.phone,
        address: data.address,
        assignedArea: data.assignedArea,
        commissionRate: data.commissionRate,
        employeeId: data.employeeId,
      })
      .returning();
    return inserted;
  });

export const updateOrderBookerFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => updateOrderBookerSchema.parse(input))
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const updateValues: any = {};
    if (updates.name !== undefined) updateValues.name = updates.name;
    if (updates.phone !== undefined) updateValues.phone = updates.phone;
    if (updates.address !== undefined) updateValues.address = updates.address;
    if (updates.assignedArea !== undefined) updateValues.assignedArea = updates.assignedArea;
    if (updates.commissionRate !== undefined) updateValues.commissionRate = updates.commissionRate;
    if (updates.employeeId !== undefined) updateValues.employeeId = updates.employeeId;
    if (updates.status !== undefined) updateValues.status = updates.status;

    const [updated] = await db
      .update(orderBookers)
      .set(updateValues)
      .where(eq(orderBookers.id, id))
      .returning();
    return updated;
  });

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTS (for dropdowns)
// ═══════════════════════════════════════════════════════════════════════════

export const getProductsFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .handler(async () => {
    return await db.query.products.findMany({
      orderBy: (products, { asc }) => [asc(products.name)],
    });
  });

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER PROFILE
// ═══════════════════════════════════════════════════════════════════════════

export const getCustomerProfileFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.id),
    });
    if (!customer) throw new Error("Customer not found");

    const [[invoiceTotals], [lineTotals]] = await Promise.all([
      db
        .select({
          totalSale: sql<number>`COALESCE(SUM(${invoices.amount}), 0)`,
          payment: sql<number>`COALESCE(SUM(${invoices.cash}), 0)`,
          credit: sql<number>`COALESCE(SUM(${invoices.credit}), 0)`,
          expenses: sql<number>`COALESCE(SUM(${invoices.expenses}), 0)`,
          invoiceDiscount: sql<number>`COALESCE(SUM(${invoices.invoiceDiscount}), 0)`,
        })
        .from(invoices)
        .where(eq(invoices.customerId, data.id)),
      db
        .select({
          revenue: sql<number>`COALESCE(SUM(${invoiceItems.amount}), 0)`,
          cogs: sql<number>`COALESCE(SUM(${invoiceItems.costOfGoodsSold}), 0)`,
          weightSaleKg: sql<number>`COALESCE(SUM(${invoiceItems.totalWeight}), 0)`,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(eq(invoices.customerId, data.id)),
    ]);

    const lifetimeProfit =
      (Number(lineTotals?.revenue) || 0) -
      (Number(lineTotals?.cogs) || 0) -
      (Number(invoiceTotals?.invoiceDiscount) || 0);

    return {
      ...customer,
      totalSale: String(Number(invoiceTotals?.totalSale) || 0),
      payment: String(Number(invoiceTotals?.payment) || 0),
      credit: String(Number(invoiceTotals?.credit) || 0),
      expenses: String(Number(invoiceTotals?.expenses) || 0),
      weightSaleKg: String(Number(lineTotals?.weightSaleKg) || 0),
      lifetimeProfit,
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// SALES OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export const getSalesOverviewFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [
      inArray(invoices.status, ["saved", "paid", "partially_paid"]),
    ];
    if (data.dateFrom) {
      conditions.push(gte(invoices.date, new Date(data.dateFrom)));
    }
    if (data.dateTo) {
      conditions.push(lte(invoices.date, new Date(data.dateTo)));
    }

    const whereClause = and(...conditions);

    // ── Product breakdown ─────────────────────────────────────────────────
    const items = await db
      .select({
        pack: invoiceItems.pack,
        numberOfCartons: invoiceItems.numberOfCartons,
        quantity: invoiceItems.quantity,
        amount: invoiceItems.amount,
        costOfGoodsSold: invoiceItems.costOfGoodsSold,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(whereClause);

    const productMap = new Map<string, {
      name: string;
      totalCartons: number;
      totalUnits: number;
      revenue: number;
      costOfGoodsSold: number;
      profit: number;
      invoiceCount: number;
    }>();

    for (const item of items) {
      const name = item.pack || "Unknown";
      const revenue = Number(item.amount) || 0;
      const cogs = Number(item.costOfGoodsSold) || 0;
      const existing = productMap.get(name);
      if (existing) {
        existing.totalCartons += Number(item.numberOfCartons) || 0;
        existing.totalUnits += Number(item.quantity) || 0;
        existing.revenue += revenue;
        existing.costOfGoodsSold += cogs;
        existing.profit += revenue - cogs;
        existing.invoiceCount += 1;
      } else {
        productMap.set(name, {
          name,
          totalCartons: Number(item.numberOfCartons) || 0,
          totalUnits: Number(item.quantity) || 0,
          revenue,
          costOfGoodsSold: cogs,
          profit: revenue - cogs,
          invoiceCount: 1,
        });
      }
    }

    // ── Period totals ─────────────────────────────────────────────────────
    const [totalRes] = await db
      .select({ total: sum(invoices.totalPrice) })
      .from(invoices)
      .where(whereClause);

    const [countRes] = await db
      .select({ value: count() })
      .from(invoices)
      .where(whereClause);

    const [profitRes] = await db
      .select({
        revenue: sql<number>`COALESCE(SUM(${invoiceItems.amount}), 0)`,
        cogs: sql<number>`COALESCE(SUM(${invoiceItems.costOfGoodsSold}), 0)`,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(whereClause);

    const totalRevenue = Number(totalRes.total) || 0;
    const totalInvoices = Number(countRes.value) || 0;
    const totalProfit = (Number(profitRes?.revenue) || 0) - (Number(profitRes?.cogs) || 0);

    // ── Customer type breakdown ───────────────────────────────────────────
    const customerTypeRows = await db
      .select({
        customerType: customers.customerType,
        total: sum(invoices.totalPrice),
        count: count(),
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause)
      .groupBy(customers.customerType);

    const customerTypeBreakdown = customerTypeRows.map((r) => ({
      customerType: r.customerType,
      revenue: Number(r.total) || 0,
      invoiceCount: Number(r.count) || 0,
    }));

    // ── Top customers ─────────────────────────────────────────────────────
    const topCustomerRows = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        total: sum(invoices.totalPrice),
        invoiceCount: count(),
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause)
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sum(invoices.totalPrice)))
      .limit(5);

    const topCustomers = topCustomerRows.map((r) => ({
      id: r.customerId,
      name: r.customerName,
      revenue: Number(r.total) || 0,
      invoiceCount: Number(r.invoiceCount) || 0,
    }));

    // ── Top salesmen ──────────────────────────────────────────────────────
    const topSalesmanRows = await db
      .select({
        salesmanId: salesmen.id,
        salesmanName: salesmen.name,
        total: sum(invoices.totalPrice),
        invoiceCount: count(),
      })
      .from(invoices)
      .innerJoin(salesmen, eq(invoices.salesmanId, salesmen.id))
      .where(whereClause)
      .groupBy(salesmen.id, salesmen.name)
      .orderBy(desc(sum(invoices.totalPrice)))
      .limit(5);

    const topSalesmen = topSalesmanRows.map((r) => ({
      id: r.salesmanId,
      name: r.salesmanName,
      revenue: Number(r.total) || 0,
      invoiceCount: Number(r.invoiceCount) || 0,
    }));

    // ── Previous period comparison ────────────────────────────────────────
    let previousRevenue = 0;
    let previousInvoices = 0;
    let previousProfit = 0;
    if (data.dateFrom && data.dateTo) {
      const from = new Date(data.dateFrom);
      const to = new Date(data.dateTo);
      const durationMs = to.getTime() - from.getTime();
      const prevFrom = new Date(from.getTime() - durationMs - 86400000);
      const prevTo = new Date(from.getTime() - 86400000);

      const prevConditions = [
        inArray(invoices.status, ["saved", "paid", "partially_paid"]),
        gte(invoices.date, prevFrom),
        lte(invoices.date, prevTo),
      ];
      const prevWhere = and(...prevConditions);

      const [prevTotalRes] = await db
        .select({ total: sum(invoices.totalPrice) })
        .from(invoices)
        .where(prevWhere);
      const [prevCountRes] = await db
        .select({ value: count() })
        .from(invoices)
        .where(prevWhere);
      const [prevProfitRes] = await db
        .select({
          revenue: sql<number>`COALESCE(SUM(${invoiceItems.amount}), 0)`,
          cogs: sql<number>`COALESCE(SUM(${invoiceItems.costOfGoodsSold}), 0)`,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
        .where(prevWhere);

      previousRevenue = Number(prevTotalRes.total) || 0;
      previousInvoices = Number(prevCountRes.value) || 0;
      previousProfit = (Number(prevProfitRes?.revenue) || 0) - (Number(prevProfitRes?.cogs) || 0);
    }

    return {
      products: Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue),
      totalRevenue,
      totalInvoices,
      totalProfit,
      customerTypeBreakdown,
      topCustomers,
      topSalesmen,
      previousRevenue,
      previousInvoices,
      previousProfit,
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMERS WITH TYPE FILTER
// ═══════════════════════════════════════════════════════════════════════════

export const getCustomersByTypeFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        customerType: z
          .enum(["distributor", "retailer", "shopkeeper", "wholesaler"])
          .optional(),
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().default(20),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.limit;
    const conditions: any[] = [];

    if (data.customerType) {
      conditions.push(eq(customers.customerType, data.customerType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [total] = await db
      .select({ value: count() })
      .from(customers)
      .where(whereClause);

    const rows = await db.query.customers.findMany({
      where: whereClause,
      limit: data.limit,
      offset,
      orderBy: [desc(customers.createdAt)],
    });

    return {
      data: rows,
      total: Number(total.value),
      pageCount: Math.ceil(Number(total.value) / data.limit),
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// RECIPES (restored for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════

export const getRecipesFn = createServerFn()
  .middleware([requireSalesConfigViewMiddleware])
  .handler(async () => {
    const rows = await db.query.recipes.findMany({
      with: {
        product: { columns: { id: true, name: true } },
      },
      orderBy: [desc(recipes.createdAt)],
    });
    return rows;
  });

export const getRecipePricesFn = createServerFn()
  .middleware([requireSalesConfigViewMiddleware])
  .handler(async () => {
    const rows = await db.query.recipePrices.findMany({
      with: {
        recipe: { columns: { id: true, name: true } },
      },
      orderBy: [desc(recipePrices.createdAt)],
    });
    return rows;
  });

export const upsertRecipePriceFn = createServerFn()
  .middleware([requireSalesConfigManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        recipeId: z.string().min(1),
        invoicePricePerPack: z.number().min(0),
        retailPricePerPack: z.number().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const updatedById = context.authContext?.session?.user?.id ?? "unknown";
    const existing = await db.query.recipePrices.findFirst({
      where: eq(recipePrices.recipeId, data.recipeId),
    });
    if (existing) {
      await db
        .update(recipePrices)
        .set({
          invoicePricePerPack: String(data.invoicePricePerPack),
          retailPricePerPack: String(data.retailPricePerPack),
          updatedById,
          updatedAt: new Date(),
        })
        .where(eq(recipePrices.id, existing.id));
      return { id: existing.id, created: false };
    } else {
      const id = createId();
      await db.insert(recipePrices).values({
        id,
        recipeId: data.recipeId,
        invoicePricePerPack: String(data.invoicePricePerPack),
        retailPricePerPack: String(data.retailPricePerPack),
        updatedById,
      });
      return { id, created: true };
    }
  });

// ═══════════════════════════════════════════════════════════════════════════
// ORDER BOOKER USER LINKING (restored for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════

export const getOrderBookerEligibleUsersFn = createServerFn()
  .middleware([requireSalesConfigViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        orderBookerId: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const linkedRows = await db.query.orderBookers.findMany({
      columns: { id: true, userId: true },
    });

    const blockedUserIds = new Set(
      linkedRows
        .filter((row) => row.id !== data.orderBookerId)
        .map((row) => row.userId)
        .filter((userId): userId is string => !!userId),
    );

    const rows = await db.query.user.findMany({
      where: eq(user.role, "order-booker"),
      columns: { id: true, name: true, email: true },
      orderBy: [desc(user.createdAt)],
    });

    return rows.filter((row) => !blockedUserIds.has(row.id));
  });

export const linkOrderBookerToUserFn = createServerFn()
  .middleware([requireSalesConfigManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        orderBookerId: z.string().min(1),
        userId: z.string().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (data.userId) {
      const userExists = await db.query.user.findFirst({
        where: eq(user.id, data.userId),
        columns: { id: true },
      });
      if (!userExists) throw new Error("User not found");

      const existingLink = await db.query.orderBookers.findFirst({
        where: and(
          eq(orderBookers.userId, data.userId),
          ne(orderBookers.id, data.orderBookerId),
        ),
        columns: { id: true, name: true },
      });
      if (existingLink) {
        throw new Error(
          `User already linked to order booker ${existingLink.name}`,
        );
      }
    }
    await db
      .update(orderBookers)
      .set({ userId: data.userId })
      .where(eq(orderBookers.id, data.orderBookerId));
    return { success: true };
  });
