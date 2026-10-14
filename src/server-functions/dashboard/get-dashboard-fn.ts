import { mixingRuns, packagingAllocations, mixingMaterialsUsed, packagingMaterialsUsed } from "@/db/schemas/production-schema";
import { createServerFn } from "@tanstack/react-start";
import { requireDashboardViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { db } from "@/db";
import { invoices } from "@/db/schemas/sales-schema";
import {

  materialStock,
  finishedGoodsStock,
  chemicals,
  packagingMaterials,
  recipes,

} from "@/db/schemas/inventory-schema";
import { payslips, payrolls, employees } from "@/db/schemas/hr-schema";
import { expenses } from "@/db/schemas/finance-schema";
import { sql, and, or, gte, lte, eq, desc, inArray } from "drizzle-orm";
import {
  format,
  startOfMonth,
} from "date-fns";

function toFloat(value: string | number | null | undefined): number {
  const n = parseFloat(String(value ?? "0"));
  return isNaN(n) ? 0 : n;
}

async function getPayrollCostForIds(payrollIds: string[]): Promise<number> {
  if (payrollIds.length === 0) return 0;
  const result = await db
    .select({ total: sql<string>`coalesce(sum(${payslips.netSalary}), 0)` })
    .from(payslips)
    .where(inArray(payslips.payrollId, payrollIds));
  return toFloat(result[0]?.total);
}

type PeriodMetrics = {
  totalRevenue: number;
  operationalExpenses: number;
  materialConsumptionCost: number;
  totalExpenses: number;
  totalPayrollCost: number;
};

async function computePeriodMetrics(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<PeriodMetrics> {
  const [
    revenueRow,
    materialConsumptionRow,
    packagingConsumptionRow,
    expensesRow,
    payrollsInRange,
  ] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${invoices.totalPrice}), 0)` })
      .from(invoices)
      .where(
        and(
          gte(invoices.createdAt, rangeStart),
          lte(invoices.createdAt, rangeEnd),
          inArray(invoices.paymentStatus, ["paid", "partially_paid"]),
        ),
      )
      .then((r) => r[0]),

    db
      .select({
        totalMaterialCost: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)`,
      })
      .from(mixingMaterialsUsed)
      .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
      .where(
        and(
          eq(mixingRuns.status, "completed"),
          gte(mixingRuns.actualCompletionDate, rangeStart),
          lte(mixingRuns.actualCompletionDate, rangeEnd),
        ),
      )
      .then((r) => r[0]),

    db
      .select({ total: sql<string>`coalesce(sum(${packagingAllocations.totalPackagingCost}), 0)` })
      .from(packagingAllocations)
      .where(and(eq(packagingAllocations.status, "completed"), gte(packagingAllocations.completedAt, rangeStart), lte(packagingAllocations.completedAt, rangeEnd)))
      .then(r => r[0]),

    db
      .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses)
      .where(and(gte(expenses.createdAt, rangeStart), lte(expenses.createdAt, rangeEnd)))
      .then((r) => r[0]),

    db.query.payrolls.findMany({
      where: and(
        gte(payrolls.createdAt, rangeStart),
        lte(payrolls.createdAt, rangeEnd),
      ),
      columns: { id: true },
    }),
  ]);

  const totalRevenue = toFloat(revenueRow?.total);
  const materialConsumptionCost = toFloat(materialConsumptionRow?.totalMaterialCost) + toFloat(packagingConsumptionRow?.total);
  const operationalExpenses = toFloat(expensesRow?.total);
  const totalExpenses = operationalExpenses + materialConsumptionCost;
  const totalPayrollCost = await getPayrollCostForIds(
    payrollsInRange.map((p) => p.id),
  );

  return {
    totalRevenue,
    operationalExpenses,
    materialConsumptionCost,
    totalExpenses,
    totalPayrollCost,
  };
}

/**
 * Compute the previous period's start/end, matching the duration of the
 * current period and ending immediately before it begins.
 */
function computePreviousPeriod(
  currentStart: Date,
  currentEnd: Date,
): { start: Date; end: Date } {
  const durationMs = currentEnd.getTime() - currentStart.getTime();
  const prevEnd = new Date(currentStart.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

export const getDashboardStatsFn = createServerFn()
  .middleware([requireDashboardViewMiddleware])
  .inputValidator(
    z.object({
      startDate: z.string().datetime().or(z.string().date()),
      endDate: z.string().datetime().or(z.string().date()),
    }),
  )
  .handler(async ({ data }) => {
    const { startDate, endDate } = data;

    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    const prevPeriod = computePreviousPeriod(rangeStart, rangeEnd);

    // ── Run current and previous period metric queries in parallel ──────
    const [
      currentMetrics,
      previousMetrics,
      mixingRow,
      packagingRow,
      chemicalStockRow,
      packagingStockRow,
      finishedGoodsRow,
      empCountRow,
    ] = await Promise.all([
      computePeriodMetrics(rangeStart, rangeEnd),
      computePeriodMetrics(prevPeriod.start, prevPeriod.end),
      db
        .select({
          activeCount: sql<number>`count(*) filter (where ${mixingRuns.status} = 'in_progress' and ${mixingRuns.createdAt} between ${rangeStart} and ${rangeEnd})`,
          completedCount: sql<number>`count(*) filter (where ${mixingRuns.status} = 'completed' and ${mixingRuns.actualCompletionDate} between ${rangeStart} and ${rangeEnd})`,
        })
        .from(mixingRuns)
        .where(or(
          and(gte(mixingRuns.createdAt, rangeStart), lte(mixingRuns.createdAt, rangeEnd)),
          and(gte(mixingRuns.actualCompletionDate, rangeStart), lte(mixingRuns.actualCompletionDate, rangeEnd)),
        ))
        .then((r) => r[0]),
      db
        .select({
          activeCount: sql<number>`count(*) filter (where ${packagingAllocations.status} = 'in_progress' and ${packagingAllocations.createdAt} between ${rangeStart} and ${rangeEnd})`,
          completedCount: sql<number>`count(*) filter (where ${packagingAllocations.status} = 'completed' and ${packagingAllocations.completedAt} between ${rangeStart} and ${rangeEnd})`,
          totalCartons: sql<string>`coalesce(sum(${packagingAllocations.actualCartonsProduced}) filter (where ${packagingAllocations.status} = 'completed' and ${packagingAllocations.completedAt} between ${rangeStart} and ${rangeEnd}), 0)`,
        })
        .from(packagingAllocations)
        .where(or(
          and(gte(packagingAllocations.createdAt, rangeStart), lte(packagingAllocations.createdAt, rangeEnd)),
          and(gte(packagingAllocations.completedAt, rangeStart), lte(packagingAllocations.completedAt, rangeEnd)),
        ))
        .then((r) => r[0]),

      db
        .select({ value: sql<string>`coalesce(sum(${materialStock.quantity}::numeric * ${chemicals.costPerUnit}::numeric), 0)` })
        .from(materialStock)
        .leftJoin(chemicals, eq(materialStock.chemicalId, chemicals.id))
        .where(sql`${materialStock.chemicalId} is not null`)
        .then((r) => r[0]),

      db
        .select({ value: sql<string>`coalesce(sum(${materialStock.quantity}::numeric * ${packagingMaterials.costPerUnit}::numeric), 0)` })
        .from(materialStock)
        .leftJoin(packagingMaterials, eq(materialStock.packagingMaterialId, packagingMaterials.id))
        .where(sql`${materialStock.packagingMaterialId} is not null`)
        .then((r) => r[0]),

      db
        .select({
          value: sql<string>`coalesce(sum(
            (
              ${finishedGoodsStock.quantityCartons} * coalesce(${recipes.containersPerCarton}, 0)
              + ${finishedGoodsStock.quantityContainers}
            )::numeric * coalesce(nullif(trim(${finishedGoodsStock.weightedAverageCostPerPack}::text), '')::numeric, 0)
          ), 0)`,
        })
        .from(finishedGoodsStock)
        .leftJoin(recipes, eq(finishedGoodsStock.recipeId, recipes.id))
        .then((r) => r[0]),

      db
        .select({ count: sql<number>`count(*)` })
        .from(employees)
        .where(eq(employees.status, "active"))
        .then((r) => r[0]),
    ]);

    // Revenue count for the current period (kept for backwards-compat)
    const invoiceCountRow = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(
        and(
          gte(invoices.createdAt, rangeStart),
          lte(invoices.createdAt, rangeEnd),
          inArray(invoices.paymentStatus, ["paid", "partially_paid"]),
        ),
      )
      .then((r) => r[0]);

    const { totalRevenue, operationalExpenses, materialConsumptionCost, totalExpenses, totalPayrollCost } = currentMetrics;
    const invoiceCount = Number(invoiceCountRow?.count ?? 0);
    const activeMixingRuns = Number(mixingRow?.activeCount ?? 0);
    const activePackagingAllocations = Number(packagingRow?.activeCount ?? 0);
    const activeProductionRuns = activeMixingRuns + activePackagingAllocations;
    const completedProductionRuns = Number(mixingRow?.completedCount ?? 0) + Number(packagingRow?.completedCount ?? 0);
    const totalCartonsProduced = toFloat(packagingRow?.totalCartons);
    const rawStockValue = toFloat(chemicalStockRow?.value) + toFloat(packagingStockRow?.value);
    const finishedStockValue = toFloat(finishedGoodsRow?.value);
    const totalStockValue = rawStockValue + finishedStockValue;
    const activeEmployees = Number(empCountRow?.count ?? 0);

    // ── Chart: single GROUP BY query per source — filtered by date range ──
    // Calculate the chart window: from rangeStart to rangeEnd, grouped by month

    const chartWindowStart = rangeStart;

    const [chartRevenue, chartExpenses, chartPayrolls, chartMaterialCosts, chartPackagingCosts] = await Promise.all([
      // Revenue by month — only paid and partially_paid
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${invoices.createdAt}), 'YYYY-MM-01')`,
          total: sql<string>`coalesce(sum(${invoices.totalPrice}), 0)`,
        })
        .from(invoices)
        .where(
          and(
            gte(invoices.createdAt, chartWindowStart),
            lte(invoices.createdAt, rangeEnd),
            inArray(invoices.paymentStatus, ["paid", "partially_paid"]),
          ),
        )
        .groupBy(sql`date_trunc('month', ${invoices.createdAt})`)
        .orderBy(sql`date_trunc('month', ${invoices.createdAt})`),

      // Expenses by month (non-payroll only — material costs added via payroll query below)
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${expenses.createdAt}), 'YYYY-MM-01')`,
          total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
        })
        .from(expenses)
        .where(and(gte(expenses.createdAt, chartWindowStart), lte(expenses.createdAt, rangeEnd)))
        .groupBy(sql`date_trunc('month', ${expenses.createdAt})`)
        .orderBy(sql`date_trunc('month', ${expenses.createdAt})`),

      // Payslips by month (payroll cost)
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${payrolls.createdAt}), 'YYYY-MM-01')`,
          total: sql<string>`coalesce(sum(${payslips.netSalary}::numeric), 0)`,
        })
        .from(payslips)
        .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
        .where(and(gte(payrolls.createdAt, chartWindowStart), lte(payrolls.createdAt, rangeEnd)))
        .groupBy(sql`date_trunc('month', ${payrolls.createdAt})`)
        .orderBy(sql`date_trunc('month', ${payrolls.createdAt})`),

      // Material consumption cost by month (for chart expense series)
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${mixingRuns.actualCompletionDate}), 'YYYY-MM-01')`,
          total: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)`,
        })
        .from(mixingMaterialsUsed)
        .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
        .where(
          and(
            eq(mixingRuns.status, "completed"),
            gte(mixingRuns.actualCompletionDate, chartWindowStart),
            lte(mixingRuns.actualCompletionDate, rangeEnd),
          ),
        )
        .groupBy(sql`date_trunc('month', ${mixingRuns.actualCompletionDate})`)
        .orderBy(sql`date_trunc('month', ${mixingRuns.actualCompletionDate})`),
      db.select({
        month: sql<string>`to_char(date_trunc('month', ${packagingAllocations.completedAt}), 'YYYY-MM-01')`,
        total: sql<string>`coalesce(sum(${packagingAllocations.totalPackagingCost}), 0)`,
      }).from(packagingAllocations)
        .where(and(eq(packagingAllocations.status, "completed"), gte(packagingAllocations.completedAt, chartWindowStart), lte(packagingAllocations.completedAt, rangeEnd)))
        .groupBy(sql`date_trunc('month', ${packagingAllocations.completedAt})`),
    ]);

    // Build lookup maps for O(1) merge
    const revenueByMonth = new Map(chartRevenue.map((r) => [r.month, toFloat(r.total)]));
    const expensesByMonth = new Map(chartExpenses.map((r) => [r.month, toFloat(r.total)]));
    const payrollByMonth = new Map(chartPayrolls.map((r) => [r.month, toFloat(r.total)]));
    const materialCostByMonth = new Map(chartMaterialCosts.map((r) => [r.month, toFloat(r.total)]));
    for (const row of chartPackagingCosts) {
      materialCostByMonth.set(row.month, (materialCostByMonth.get(row.month) ?? 0) + toFloat(row.total));
    }

    // Generate month keys from chartWindowStart to rangeEnd
    // Use endOfMonth to ensure we capture the full range
    const chartWindowEnd = startOfMonth(rangeEnd);
    const monthsDiff = (chartWindowEnd.getFullYear() - chartWindowStart.getFullYear()) * 12 + (chartWindowEnd.getMonth() - chartWindowStart.getMonth());
    const monthCount = Math.max(1, monthsDiff + 1);

    const revenueExpenseChart = Array.from({ length: monthCount }, (_, i) => {
      const mDate = new Date(chartWindowStart.getFullYear(), chartWindowStart.getMonth() + i, 1);
      const key = format(mDate, "yyyy-MM-01");
      const label = format(mDate, "01 MMM");
      const rev = revenueByMonth.get(key) ?? 0;
      const exp = (expensesByMonth.get(key) ?? 0) + (payrollByMonth.get(key) ?? 0) + (materialCostByMonth.get(key) ?? 0);
      const payroll = payrollByMonth.get(key) ?? 0;
      return { month: label, revenue: rev, expenses: exp, payroll };
    });

    // ── Recent activity — only 5 most recent ─────────────────────────────
    const [recentMixing, recentPackaging] = await Promise.all([
      db.query.mixingRuns.findMany({
        with: { formula: { with: { product: true } }, operator: true },
        orderBy: (run, { desc }) => [desc(run.updatedAt)], limit: 5,
      }),
      db.query.packagingAllocations.findMany({
        with: { recipe: { with: { product: true } }, mixingRun: true, operator: true },
        orderBy: (allocation, { desc }) => [desc(allocation.updatedAt)], limit: 5,
      }),
    ]);
    const recentActivity = [
      ...recentMixing.map(run => ({
        id: run.id, batchId: run.batchId,
        productName: run.formula.product.name, recipeName: run.formula.name,
        cartonsProduced: 0, containersProduced: 0, status: run.status,
        operatorName: run.operator.name, date: run.updatedAt,
        totalProductionCost: Number(run.totalChemicalCost ?? 0),
      })),
      ...recentPackaging.map(allocation => ({
        id: allocation.id, batchId: allocation.mixingRun.batchId,
        productName: allocation.recipe.product.name, recipeName: allocation.recipe.name,
        cartonsProduced: allocation.actualCartonsProduced ?? 0,
        containersProduced: allocation.completedContainers ?? 0,
        status: allocation.status, operatorName: allocation.operator.name,
        date: allocation.updatedAt, totalProductionCost: Number(allocation.totalProductionCost ?? 0),
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 5);

    // ── Previous period totals for chart "vs previous period" comparison ─
    const prevTotalRevenue = previousMetrics.totalRevenue;
    const prevTotalExpenses =
      previousMetrics.totalExpenses + previousMetrics.totalPayrollCost;
    const prevNet = prevTotalRevenue - prevTotalExpenses;

    return {
      totalRevenue,
      invoiceCount,
      activeProductionRuns,
      activeMixingRuns,
      activePackagingAllocations,
      completedProductionRuns,
      totalCartonsProduced,
      rawStockValue,
      finishedStockValue,
      totalStockValue,
      totalPayrollCost,
      totalExpenses,
      // Breakdown for transparency
      operationalExpenses,
      materialConsumptionCost,
      totalCost: totalPayrollCost + totalExpenses,
      netProfit: totalRevenue - totalPayrollCost - totalExpenses,
      activeEmployees,
      revenueExpenseChart,
      recentActivity,
      period: {
        startStr: format(rangeStart, "yyyy-MM-dd"),
        endStr: format(rangeEnd, "yyyy-MM-dd"),
      },
      previousPeriod: {
        startStr: format(prevPeriod.start, "yyyy-MM-dd"),
        endStr: format(prevPeriod.end, "yyyy-MM-dd"),
        totalRevenue: prevTotalRevenue,
        totalExpenses: prevTotalExpenses,
        net: prevNet,
      },
    };
  });
