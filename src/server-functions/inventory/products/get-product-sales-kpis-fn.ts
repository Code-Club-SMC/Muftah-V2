import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";
import { invoices, invoiceItems } from "@/db/schemas/sales-schema";
import { recipes, products } from "@/db/schemas/inventory-schema";
import { z } from "zod";
import { and, eq, gte, lte, sql, sum, inArray } from "drizzle-orm";
import { parseISO, isValid, endOfDay } from "date-fns";

export const getProductSalesKpisFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const conditions = [
      inArray(invoices.paymentStatus, ["paid", "partially_paid"]),
      sql`${invoiceItems.recipeId} IS NOT NULL`,
    ];

    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(invoices.date, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(invoices.date, endOfDay(to)));
    }

    // Aggregate totals across all products
    const [overall] = await db
      .select({
        totalCartons: sum(invoiceItems.numberOfCartons),
        totalUnits: sum(invoiceItems.quantity),
        totalRevenue: sum(invoiceItems.amount),
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(and(...conditions));

    // Per-product breakdown
    const perProduct = await db
      .select({
        productId: products.id,
        productName: products.name,
        totalCartons: sum(invoiceItems.numberOfCartons),
        totalUnits: sum(invoiceItems.quantity),
        totalRevenue: sum(invoiceItems.amount),
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .innerJoin(recipes, eq(invoiceItems.recipeId, recipes.id))
      .innerJoin(products, eq(recipes.productId, products.id))
      .where(and(...conditions))
      .groupBy(products.id, products.name)
      .orderBy(sql`SUM(${invoiceItems.amount}) DESC`);

    return {
      overall: {
        totalCartons: Number(overall?.totalCartons ?? 0),
        totalUnits: Number(overall?.totalUnits ?? 0),
        totalRevenue: Number(overall?.totalRevenue ?? 0),
      },
      perProduct: perProduct.map((p) => ({
        productId: p.productId,
        productName: p.productName,
        totalCartons: Number(p.totalCartons ?? 0),
        totalUnits: Number(p.totalUnits ?? 0),
        totalRevenue: Number(p.totalRevenue ?? 0),
      })),
    };
  });
