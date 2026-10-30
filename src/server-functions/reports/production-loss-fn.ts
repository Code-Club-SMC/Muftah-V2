import Big from "big.js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { PRODUCTION_LOSS_LIMITS_ID, productionLossLimits } from "@/db/schemas/production-schema";
import { requireLossLimitsManageMiddleware, requireLossReportViewMiddleware } from "@/lib/middlewares";
import { reportDateBounds } from "@/lib/report-dates";
import { LOSS_PRINT_MAX_ROWS, LOSS_TABS, TOO_MANY_TO_PRINT, type LossTab } from "@/lib/production/loss-report";
import {
  filterLossRows, lossColumns, lossFilterOptions, lossFiltersText, lossStripTotals, lossSummary, pageLossRows, type LossSummaryItem,
} from "@/lib/production/loss-display";
import { loadLossRows, readLossLimits } from "./production-loss-queries.server";

const filtersSchema = z.object({
  productId: z.string().optional(), formulaId: z.string().optional(), chemicalId: z.string().optional(),
  materialId: z.string().optional(), storeId: z.string().optional(), reason: z.string().optional(),
}).default({});
const viewSchema = z.object({
  tab: z.enum(LOSS_TABS), dateFrom: z.string(), dateTo: z.string(), filters: filtersSchema, onlyOverLimit: z.boolean().default(false),
});

function bounds(input: { dateFrom: string; dateTo: string }) {
  const { fromDate, toDate } = reportDateBounds(input);
  if (!fromDate || !toDate) throw new Error("Pick a date range");
  return { fromDate, toDate };
}

const columnHeads = (tab: LossTab) => lossColumns(tab).map(({ key, label, numeric, percent }) => ({ key, label, numeric: !!numeric, percent: !!percent }));
const totalsRow = (tab: LossTab, rows: Parameters<typeof lossSummary>[1]) => lossColumns(tab).map((column) => column.total?.(rows) ?? "");

export const getProductionLossFn = createServerFn()
  .middleware([requireLossReportViewMiddleware])
  .inputValidator(viewSchema.extend({ page: z.number().int().positive().default(1) }))
  .handler(async ({ data }) => {
    const range = bounds(data);
    const { limits, updatedAt, updatedBy } = await readLossLimits(db);
    const loaded = await Promise.all(LOSS_TABS.map((tab) => loadLossRows(db, tab, range, limits)));
    const byTab = Object.fromEntries(LOSS_TABS.map((tab, i) => [tab, loaded[i]])) as Record<LossTab, (typeof loaded)[number]>;
    const tabRows = byTab[data.tab];
    const filtered = filterLossRows(data.tab, tabRows, data.filters, data.onlyOverLimit);
    const paged = pageLossRows(filtered, data.page);
    return {
      strip: lossStripTotals(byTab), limits, limitsUpdatedAt: updatedAt, limitsUpdatedBy: updatedBy,
      options: lossFilterOptions(data.tab, tabRows), summary: lossSummary(data.tab, filtered), totals: totalsRow(data.tab, filtered),
      columns: columnHeads(data.tab), rows: paged.rows, total: filtered.length, page: paged.page, pageCount: paged.pageCount,
    };
  });

export type LossPrintData = {
  tab: LossTab; dateFrom: string; dateTo: string; filtersText: string; summary: LossSummaryItem[];
  columns: ReturnType<typeof columnHeads>; rows: { over: boolean; cells: string[] }[]; totals: string[];
};

export const getProductionLossPrintFn = createServerFn()
  .middleware([requireLossReportViewMiddleware])
  .inputValidator(viewSchema)
  .handler(async ({ data }): Promise<LossPrintData> => {
    const { limits } = await readLossLimits(db);
    const tabRows = await loadLossRows(db, data.tab, bounds(data), limits);
    const filtered = filterLossRows(data.tab, tabRows, data.filters, data.onlyOverLimit);
    if (filtered.length > LOSS_PRINT_MAX_ROWS) throw new Error(TOO_MANY_TO_PRINT);
    const columns = lossColumns(data.tab);
    return {
      tab: data.tab, dateFrom: data.dateFrom, dateTo: data.dateTo,
      filtersText: lossFiltersText(data.tab, data.filters, lossFilterOptions(data.tab, tabRows)),
      summary: lossSummary(data.tab, filtered), columns: columnHeads(data.tab),
      rows: filtered.map((row) => ({ over: row.over, cells: columns.map((column) => column.cell(row)) })),
      totals: totalsRow(data.tab, filtered),
    };
  });

const limitValue = z.string().trim()
  .regex(/^\d{1,3}(?:\.\d)?$/, "Use a number with up to one decimal place")
  .refine((value) => new Big(value).lte(100), "Use a limit from 0 to 100");

export const updateLossLimitsFn = createServerFn()
  .middleware([requireLossLimitsManageMiddleware])
  .inputValidator(z.object({ batch: limitValue, chemical: limitValue, powder: limitValue, shopper: limitValue, otherPacking: limitValue }))
  .handler(async ({ data, context }) => {
    const values = { ...data, updatedBy: context.session.user.id };
    await db.insert(productionLossLimits).values({ id: PRODUCTION_LOSS_LIMITS_ID, ...values })
      .onConflictDoUpdate({ target: productionLossLimits.id, set: { ...values, updatedAt: new Date() } });
    return { success: true as const };
  });
