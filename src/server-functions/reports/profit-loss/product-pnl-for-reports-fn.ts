import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products } from "@/db/schemas/inventory-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { REPORT_SOURCES, type ReportSource } from "@/lib/report-source";
import {
  buildScopedStatus,
  calculateDelta,
  calculatePointDelta,
  createComparisonLabel,
  createPeriodLabel,
  createPreviousRange,
  createReportDateRange,
  fetchScopedFailedBatchLosses,
  fetchProductRecipeBreakdown,
  fetchProductRecentInvoices,
  fetchScopedSummary,
  fetchScopedTrend,
  type PnlMetrics,
  type PnlTrendPoint,
  type ProfitStatus,
  type RealizedInvoiceRow,
  type RecipeBreakdownRow,
  type ScopedFailedBatchLossRow,
} from "./reporting-core";

export interface ProductProfitLossForReportsResult {
  generatedAt: string;
  source: ReportSource;
  comparisonLabel: string;
  reportPeriod: {
    dateFrom: string;
    dateTo: string;
    label: string;
  };
  comparisonPeriod: {
    dateFrom: string;
    dateTo: string;
  };
  product: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    imageUrl: string | null;
    productCode: string | null;
  };
  summary: PnlMetrics;
  previousSummary: PnlMetrics;
  status: ProfitStatus;
  kpis: {
    totalRevenueDeltaPercent: number;
    totalCogsDeltaPercent: number;
    grossProfitDeltaPercent: number;
    grossMarginDeltaPoints: number;
    directProfitDeltaPercent: number;
    directMarginDeltaPoints: number;
    failedBatchLossesDeltaPercent: number;
    netImpactDeltaPercent: number;
    netImpactMarginDeltaPoints: number;
  };
  monthlyTrend: PnlTrendPoint[];
  recipes: RecipeBreakdownRow[];
  recentInvoices: RealizedInvoiceRow[];
  failedBatchLosses: ScopedFailedBatchLossRow[];
}

export const getProductProfitLossForReportsFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        productId: z.string().min(1),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        source: z.enum(REPORT_SOURCES).default("all"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const range = createReportDateRange({
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
    });
    const previousRange = createPreviousRange(range);

    const product = await db.query.products.findFirst({
      where: eq(products.id, data.productId),
    });

    if (!product) {
      throw new Error("Product not found");
    }

    const [
      summary,
      previousSummary,
      monthlyTrend,
      recipesData,
      recentInvoices,
      failedBatchLosses,
    ] = await Promise.all([
      fetchScopedSummary({
        productId: data.productId,
        fromDate: range.fromDate,
        toDate: range.toDate,
        source: data.source,
      }),
      fetchScopedSummary({
        productId: data.productId,
        fromDate: previousRange.fromDate,
        toDate: previousRange.toDate,
        source: data.source,
      }),
      fetchScopedTrend({
        productId: data.productId,
        endDate: range.toDate,
        months: 6,
        source: data.source,
      }),
      fetchProductRecipeBreakdown(data.productId, range, data.source),
      fetchProductRecentInvoices(data.productId, range, 12, data.source),
      fetchScopedFailedBatchLosses(
        { productId: data.productId, source: data.source },
        range,
      ),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      source: data.source,
      comparisonLabel: createComparisonLabel(range, previousRange),
      reportPeriod: {
        dateFrom: range.fromDate.toISOString(),
        dateTo: range.toDate.toISOString(),
        label: createPeriodLabel(range),
      },
      comparisonPeriod: {
        dateFrom: previousRange.fromDate.toISOString(),
        dateTo: previousRange.toDate.toISOString(),
      },
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        imageUrl: null,
        productCode: null,
      },
      summary,
      previousSummary,
      status: buildScopedStatus(summary),
      kpis: {
        totalRevenueDeltaPercent: calculateDelta(
          summary.totalRevenue,
          previousSummary.totalRevenue,
        ),
        totalCogsDeltaPercent: calculateDelta(
          summary.totalCogs,
          previousSummary.totalCogs,
        ),
        grossProfitDeltaPercent: calculateDelta(
          summary.grossProfit,
          previousSummary.grossProfit,
        ),
        grossMarginDeltaPoints: calculatePointDelta(
          summary.grossMarginPercent,
          previousSummary.grossMarginPercent,
        ),
        directProfitDeltaPercent: calculateDelta(
          summary.netProfit,
          previousSummary.netProfit,
        ),
        directMarginDeltaPoints: calculatePointDelta(
          summary.netMarginPercent,
          previousSummary.netMarginPercent,
        ),
        failedBatchLossesDeltaPercent: calculateDelta(
          summary.failedBatchLosses,
          previousSummary.failedBatchLosses,
        ),
        netImpactDeltaPercent: calculateDelta(
          summary.netImpact,
          previousSummary.netImpact,
        ),
        netImpactMarginDeltaPoints: calculatePointDelta(
          summary.netImpactMarginPercent,
          previousSummary.netImpactMarginPercent,
        ),
      },
      monthlyTrend,
      recipes: recipesData,
      recentInvoices,
      failedBatchLosses,
    } satisfies ProductProfitLossForReportsResult;
  });
