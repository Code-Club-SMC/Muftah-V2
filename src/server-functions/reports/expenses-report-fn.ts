import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { expenses, expenseCategories, wallets } from "@/db/schemas/finance-schema";
import {
  chemicals,
  failedProductionChemicalRecoveries,
  recipes,
  products,
  warehouses,
  productionRuns,
} from "@/db/schemas/inventory-schema";
import { packagingAllocations, mixingRuns, formulas } from "@/db/schemas/production-schema";
import { z } from "zod";
import { and, eq, gte, lte, sql, desc } from "drizzle-orm";
import { reportDateBounds } from "@/lib/report-dates";

export const getExpensesReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { fromDate, toDate } = reportDateBounds(data);
    const conditions = [];

    if (fromDate) {
      conditions.push(gte(expenses.expenseDate, fromDate));
    }
    if (toDate) {
      conditions.push(lte(expenses.expenseDate, toDate));
    }

    // Finance expenses
    const financeRows = await db
      .select({
        expenseId: expenses.id,
        expenseDate: expenses.expenseDate,
        description: expenses.description,
        amount: expenses.amount,
        slipNumber: expenses.slipNumber,
        remarks: expenses.remarks,
        categoryName: expenseCategories.name,
        walletName: wallets.name,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .leftJoin(wallets, eq(expenses.walletId, wallets.id))
      .where(and(...conditions))
      .orderBy(desc(expenses.expenseDate));

    const totalFinanceExpenses = financeRows.reduce((s, r) => s + Number(r.amount), 0);

    // Production costs (filter by actualStartDate with fallback to createdAt)
    const prodConditions = [];
    if (fromDate) {
      prodConditions.push(
        gte(sql`COALESCE(${packagingAllocations.completedAt}, ${packagingAllocations.createdAt})`, fromDate),
      );
    }
    if (toDate) {
      prodConditions.push(
        lte(sql`COALESCE(${packagingAllocations.completedAt}, ${packagingAllocations.createdAt})`, toDate),
      );
    }

    const productionRows = await db
      .select({
        runId: packagingAllocations.id,
        batchId: mixingRuns.batchId,
        actualCompletionDate: packagingAllocations.completedAt,
        status: packagingAllocations.status,
        totalChemicalCost: packagingAllocations.allocatedChemicalCost,
        totalPackagingCost: packagingAllocations.totalPackagingCost,
        totalProductionCost: packagingAllocations.totalProductionCost,
        costPerContainer: packagingAllocations.actualCostPerPack,
        actualCostPerPack: packagingAllocations.actualCostPerPack,
        actualCostPerCarton: packagingAllocations.actualCostPerCarton,
        plannedCartonsProduced: packagingAllocations.targetCartons,
        actualCartonsProduced: packagingAllocations.actualCartonsProduced,
        actualPacksProduced: packagingAllocations.actualPacksProduced,
        yieldVarianceCartons: packagingAllocations.yieldVarianceCartons,
        containersProduced: packagingAllocations.completedContainers,
        productName: products.name,
        recipeName: recipes.name,
        warehouseName: warehouses.name,
      })
      .from(packagingAllocations)
      .innerJoin(mixingRuns, eq(packagingAllocations.mixingRunId, mixingRuns.id))
      .innerJoin(recipes, eq(packagingAllocations.recipeId, recipes.id))
      .innerJoin(products, eq(recipes.productId, products.id))
      .innerJoin(warehouses, eq(packagingAllocations.warehouseId, warehouses.id))
      .where(and(eq(packagingAllocations.status, "completed"), ...prodConditions))
      .orderBy(desc(packagingAllocations.completedAt));

    const totalProductionCosts = productionRows.reduce(
      (s, r) => s + Number(r.totalProductionCost),
      0,
    );

    const failedBatchLossConditions = [];
    if (fromDate) {
      failedBatchLossConditions.push(
        gte(failedProductionChemicalRecoveries.createdAt, fromDate),
      );
    }
    if (toDate) {
      failedBatchLossConditions.push(
        lte(failedProductionChemicalRecoveries.createdAt, toDate),
      );
    }

    const failedBatchLossRows = await db
      .select({
        settlementId: failedProductionChemicalRecoveries.id,
        settledAt: failedProductionChemicalRecoveries.createdAt,
        batchId: sql<string>`COALESCE(${productionRuns.batchId}, ${mixingRuns.batchId})`,
        productName: products.name,
        recipeName: sql<string>`COALESCE(${recipes.name}, ${formulas.name})`,
        chemicalName: chemicals.name,
        expectedQuantity: failedProductionChemicalRecoveries.expectedQuantity,
        recoveredQuantity: failedProductionChemicalRecoveries.recoveredQuantity,
        lossQuantity: failedProductionChemicalRecoveries.lossQuantity,
        costPerUnit: failedProductionChemicalRecoveries.costPerUnit,
        lossAmount: failedProductionChemicalRecoveries.lossAmount,
      })
      .from(failedProductionChemicalRecoveries)
      .leftJoin(
        productionRuns,
        eq(failedProductionChemicalRecoveries.productionRunId, productionRuns.id),
      )
      .leftJoin(mixingRuns, eq(failedProductionChemicalRecoveries.mixingRunId, mixingRuns.id))
      .leftJoin(recipes, eq(productionRuns.recipeId, recipes.id))
      .leftJoin(formulas, eq(mixingRuns.formulaId, formulas.id))
      .leftJoin(products, sql`${products.id} = COALESCE(${recipes.productId}, ${formulas.productId})`)
      .innerJoin(chemicals, eq(failedProductionChemicalRecoveries.chemicalId, chemicals.id))
      .where(and(...failedBatchLossConditions))
      .orderBy(desc(failedProductionChemicalRecoveries.createdAt));

    const totalFailedBatchLosses = failedBatchLossRows.reduce(
      (sum, row) => sum + Number(row.lossAmount),
      0,
    );

    return {
      financeExpenses: financeRows.map((r) => ({
        ...r,
        amount: Number(r.amount),
      })),
      productionCosts: productionRows.map((r) => ({
        ...r,
        containersProduced: r.containersProduced ?? 0,
        totalChemicalCost: Number(r.totalChemicalCost),
        totalPackagingCost: Number(r.totalPackagingCost),
        totalProductionCost: Number(r.totalProductionCost),
        costPerContainer: Number(r.costPerContainer),
        actualCostPerPack: Number(r.actualCostPerPack || "0"),
        actualCostPerCarton: Number(r.actualCostPerCarton || "0"),
        plannedCartonsProduced: r.plannedCartonsProduced ?? 0,
        actualCartonsProduced: r.actualCartonsProduced ?? 0,
        actualPacksProduced: r.actualPacksProduced ?? 0,
        yieldVarianceCartons: r.yieldVarianceCartons ?? ((r.plannedCartonsProduced ?? 0) - (r.actualCartonsProduced ?? 0)),
      })),
      failedBatchLosses: failedBatchLossRows.map((row) => ({
        ...row,
        expectedQuantity: Number(row.expectedQuantity),
        recoveredQuantity: Number(row.recoveredQuantity),
        lossQuantity: Number(row.lossQuantity),
        costPerUnit: Number(row.costPerUnit),
        lossAmount: Number(row.lossAmount),
      })),
      summary: {
        totalFinanceExpenses,
        totalProductionCosts,
        totalFailedBatchLosses,
        grandTotal: totalFinanceExpenses + totalProductionCosts + totalFailedBatchLosses,
        financeCount: financeRows.length,
        productionCount: productionRows.length,
        failedBatchLossCount: failedBatchLossRows.length,
      },
    };
  });
