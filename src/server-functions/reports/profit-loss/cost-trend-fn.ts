import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { recipes } from "@/db/schemas/inventory-schema";
import { invoices, invoiceItems } from "@/db/schemas/sales-schema";
import { currentReportMonth, formatReportMonth, reportDateBounds, reportDateKey, reportMonth } from "@/lib/report-dates";

export const getPnlCostTrendFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      recipeId: z.string().min(1),
      months: z.number().int().min(1).max(24).default(12),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { recipeId, months } = data;

    const current = currentReportMonth();
    const first = reportMonth(current.from, -months + 1);
    const { fromDate: startDate, toDate: endDate } = reportDateBounds({ dateFrom: first.from, dateTo: reportDateKey(new Date()) });

    // 1. Recipe info
    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, recipeId),
      with: { product: true },
    });
    if (!recipe) throw new Error("Recipe not found");

    // 2. Monthly cost trend from invoice COGS
    const monthlyData = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${invoices.date} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi'), 'YYYY-MM-01')`,
        avgCogsPerUnit: sql<number>`COALESCE(AVG(${invoiceItems.costOfGoodsSoldPerUnit}), 0)`,
        avgRevenuePerUnit: sql<number>`COALESCE(AVG(${invoiceItems.perCartonPrice}::numeric / NULLIF(${recipes.containersPerCarton}, 0)), 0)`,
        totalRevenue: sql<number>`COALESCE(SUM(${invoiceItems.amount}), 0)`,
        totalCogs: sql<number>`COALESCE(SUM(${invoiceItems.costOfGoodsSold}), 0)`,
        totalUnits: sql<number>`COALESCE(SUM(${invoiceItems.quantity}), 0) + COALESCE(SUM(${invoiceItems.numberOfCartons} * NULLIF(${recipes.containersPerCarton}, 0)), 0)`,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .innerJoin(recipes, eq(invoiceItems.recipeId, recipes.id))
      .where(
        and(
          eq(invoiceItems.recipeId, recipeId),
          inArray(invoices.paymentStatus, ["paid", "partially_paid"]),
          gte(invoices.date, startDate!),
          lte(invoices.date, endDate!),
        ),
      )
      .groupBy(sql`date_trunc('month', ${invoices.date} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')`)
      .orderBy(sql`date_trunc('month', ${invoices.date} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')`);

    // 3. Build trend array
    const trend = monthlyData.map((row) => {
      const revenue = Number(row.totalRevenue);
      const cogs = Number(row.totalCogs);
      const units = Number(row.totalUnits);
      return {
        month: row.month,
        monthLabel: formatReportMonth(row.month),
        avgCogsPerUnit: Number(row.avgCogsPerUnit),
        avgRevenuePerUnit: Number(row.avgRevenuePerUnit),
        revenue,
        cogs,
        profit: revenue - cogs,
        margin: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
        units,
        avgCostPerUnit: units > 0 ? cogs / units : 0,
      };
    });

    return {
      recipe: {
        id: recipe.id,
        name: recipe.name,
        product: recipe.product,
        containersPerCarton: recipe.containersPerCarton,
      },
      trend,
      months,
      dateFrom: startDate!.toISOString(),
      dateTo: endDate!.toISOString(),
    };
  });
