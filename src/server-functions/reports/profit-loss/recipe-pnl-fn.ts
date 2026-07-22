import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  finishedGoodsStock,
  recipes,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import {
  buildScopedStatus,
  buildVariantLabel,
  calculateDelta,
  calculatePointDelta,
  createComparisonLabel,
  createPeriodLabel,
  createPreviousRange,
  createReportDateRange,
  fetchScopedFailedBatchLosses,
  fetchRecipeInvoiceDetails,
  fetchScopedSummary,
  fetchScopedTrend,
  type PnlMetrics,
  type PnlTrendPoint,
  type ProfitStatus,
  type RealizedInvoiceRow,
  type ScopedFailedBatchLossRow,
} from "./reporting-core";

export interface RecipeProfitLossResult {
  generatedAt: string;
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
  recipe: {
    id: string;
    name: string;
    recipeCode: string | null;
    variantLabel: string | null;
    product: {
      id: string;
      name: string;
      productCode: string | null;
    };
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
    soldUnitsDeltaPercent: number;
    averageSellingPricePerUnitDeltaPercent: number;
    cogsPerUnitDeltaPercent: number;
    grossProfitPerUnitDeltaPercent: number;
    directProfitPerUnitDeltaPercent: number;
    netImpactPerUnitDeltaPercent: number;
  };
  monthlyTrend: PnlTrendPoint[];
  invoiceDetails: RealizedInvoiceRow[];
  failedBatchLosses: ScopedFailedBatchLossRow[];
  currentInventoryWacPerPack: number | null;
}

export const getRecipeProfitLossFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        recipeId: z.string().min(1),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const range = createReportDateRange({
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
    });
    const previousRange = createPreviousRange(range);

    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, data.recipeId),
      with: {
        product: true,
      },
    });

    if (!recipe) {
      throw new Error("Recipe not found");
    }

    const factoryFloor = await db.query.warehouses.findFirst({
      where: eq(warehouses.type, "factory_floor"),
      columns: { id: true },
    });

    const factoryFloorStock = factoryFloor
      ? await db.query.finishedGoodsStock.findFirst({
          where: and(
            eq(finishedGoodsStock.warehouseId, factoryFloor.id),
            eq(finishedGoodsStock.recipeId, data.recipeId),
          ),
          columns: {
            weightedAverageCostPerPack: true,
          },
        })
      : null;

    const [
      summary,
      previousSummary,
      monthlyTrend,
      invoiceDetails,
      failedBatchLosses,
    ] =
      await Promise.all([
        fetchScopedSummary({
          recipeId: data.recipeId,
          fromDate: range.fromDate,
          toDate: range.toDate,
        }),
        fetchScopedSummary({
          recipeId: data.recipeId,
          fromDate: previousRange.fromDate,
          toDate: previousRange.toDate,
        }),
        fetchScopedTrend({
          recipeId: data.recipeId,
          endDate: range.toDate,
          months: 6,
        }),
        fetchRecipeInvoiceDetails(data.recipeId, range),
        fetchScopedFailedBatchLosses({ recipeId: data.recipeId }, range),
      ]);

    return {
      generatedAt: new Date().toISOString(),
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
      recipe: {
        id: recipe.id,
        name: recipe.name,
        recipeCode: null,
        variantLabel: buildVariantLabel(recipe.fillAmount, recipe.fillUnit),
        product: {
          id: recipe.product.id,
          name: recipe.product.name,
          productCode: null,
        },
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
        soldUnitsDeltaPercent: calculateDelta(
          summary.soldUnits,
          previousSummary.soldUnits,
        ),
        averageSellingPricePerUnitDeltaPercent: calculateDelta(
          summary.averageSellingPricePerUnit,
          previousSummary.averageSellingPricePerUnit,
        ),
        cogsPerUnitDeltaPercent: calculateDelta(
          summary.cogsPerUnit,
          previousSummary.cogsPerUnit,
        ),
        grossProfitPerUnitDeltaPercent: calculateDelta(
          summary.grossProfitPerUnit,
          previousSummary.grossProfitPerUnit,
        ),
        directProfitPerUnitDeltaPercent: calculateDelta(
          summary.netProfitPerUnit,
          previousSummary.netProfitPerUnit,
        ),
        netImpactPerUnitDeltaPercent: calculateDelta(
          summary.netImpactPerUnit,
          previousSummary.netImpactPerUnit,
        ),
      },
      monthlyTrend,
      invoiceDetails,
      failedBatchLosses,
      currentInventoryWacPerPack:
        factoryFloorStock &&
        Number(factoryFloorStock.weightedAverageCostPerPack ?? 0) > 0
          ? Number(factoryFloorStock.weightedAverageCostPerPack)
          : null,
    } satisfies RecipeProfitLossResult;
  });
