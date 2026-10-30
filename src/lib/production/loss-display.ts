// src/lib/production/loss-display.ts
import Big from "big.js";
import { formatIndianStyle, formatNumber } from "@/lib/currency-format";
import { formatReportDate } from "@/lib/report-dates";
import {
  LOSS_PAGE_SIZE, LOSS_TABS, lossPercent, sumMoney, weightedShopperPercent,
  type LossRow, type LossRowOf, type LossTab,
} from "./loss-report";

export const formatLossMoney = (value: Big.BigSource) => formatIndianStyle(new Big(value).round(0, Big.roundHalfUp).toNumber());
const rupees = (value: Big.BigSource) => `Rs ${formatLossMoney(value)}`;
const UNIT_LABELS: Record<string, string> = { kg: "KG", liters: "L", l: "L", pcs: "pcs" };
export const unitLabel = (unit: string) => UNIT_LABELS[unit.toLowerCase()] ?? unit;
export const formatLossQuantity = (value: Big.BigSource, unit: string) => `${formatNumber(new Big(value).toNumber())} ${unitLabel(unit)}`.trim();
export const formatLossRange = (dateFrom: string, dateTo: string) => `${formatReportDate(dateFrom)} – ${formatReportDate(dateTo)}`;
const percentText = (percent: string | null) => (percent === null ? "—" : `${percent}%`);

// Sums a quantity per unit: "4,500 KG · 200 L".
function byUnit<R>(rows: R[], unit: (row: R) => string, value: (row: R) => Big.BigSource) {
  const sums = new Map<string, Big>();
  for (const row of rows) sums.set(unit(row), (sums.get(unit(row)) ?? new Big(0)).plus(value(row)));
  return sums;
}
const byUnitText = (sums: Map<string, Big>) => [...sums].map(([unit, sum]) => formatLossQuantity(sum, unit)).join(" · ");
const sumCost = (rows: { cost: string }[]) => sumMoney(rows.map((row) => row.cost));
// Loss % of a total only when every row shares one unit.
function totalPercent(loss: Map<string, Big>, base: Map<string, Big>) {
  if (loss.size !== 1) return "";
  const [unit] = [...loss.keys()];
  return percentText(lossPercent(loss.get(unit)!, base.get(unit) ?? 0));
}
function mostLost<R extends { cost: string }>(rows: R[], name: (row: R) => string) {
  const totals = new Map<string, Big>();
  for (const row of rows) totals.set(name(row), (totals.get(name(row)) ?? new Big(0)).plus(row.cost));
  let best: [string, Big] | null = null;
  for (const entry of totals) if (entry[1].gt(0) && (!best || entry[1].gt(best[1]))) best = entry;
  return best?.[0] ?? "—";
}

export type LossColumn = { key: string; label: string; numeric?: boolean; percent?: boolean; cell: (row: LossRow) => string; total?: (rows: LossRow[]) => string };
type Column<R> = { key: string; label: string; numeric?: boolean; percent?: boolean; cell: (row: R) => string; total?: (rows: R[]) => string };

const dateColumn = <R extends LossRow>(): Column<R> => ({ key: "date", label: "Date", cell: (row) => formatReportDate(row.date), total: () => "Total" });
const batchColumn = <R extends { batchId: string }>(): Column<R> => ({ key: "batch", label: "Batch", cell: (row) => row.batchId });
const productColumn = <R extends { product: string }>(): Column<R> => ({ key: "product", label: "Product", cell: (row) => row.product });
const costColumn = <R extends { cost: string }>(): Column<R> => ({ key: "cost", label: "Loss Rs", numeric: true, cell: (row) => formatLossMoney(row.cost), total: (rows) => formatLossMoney(sumCost(rows)) });
const reasonColumn = <R extends LossRow>(): Column<R> => ({ key: "reason", label: "Reason", cell: (row) => row.reason });

const BATCH: Column<LossRowOf<"batch">>[] = [
  dateColumn(), batchColumn(), productColumn(),
  { key: "target", label: "Target", numeric: true, cell: (r) => formatLossQuantity(r.target, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.target)) },
  { key: "actual", label: "Actual", numeric: true, cell: (r) => formatLossQuantity(r.actual, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.actual)) },
  { key: "loss", label: "Loss", numeric: true, cell: (r) => formatLossQuantity(r.loss, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.loss)) },
  { key: "percent", label: "Loss %", numeric: true, percent: true, cell: (r) => percentText(r.percent), total: (rows) => totalPercent(byUnit(rows, (r) => r.unit, (r) => r.loss), byUnit(rows, (r) => r.unit, (r) => r.target)) },
  costColumn(), reasonColumn(),
];
const CHEMICAL: Column<LossRowOf<"chemical">>[] = [
  dateColumn(), batchColumn(),
  { key: "chemical", label: "Chemical", cell: (r) => r.chemical },
  { key: "formula", label: "Formula", numeric: true, cell: (r) => formatLossQuantity(r.formula, r.unit) },
  { key: "used", label: "Used", numeric: true, cell: (r) => formatLossQuantity(r.used, r.unit) },
  { key: "extra", label: "Extra", numeric: true, cell: (r) => formatLossQuantity(r.extra, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.extra)) },
  { key: "percent", label: "Extra %", numeric: true, percent: true, cell: (r) => percentText(r.percent) },
  costColumn(), reasonColumn(),
];
const POWDER: Column<LossRowOf<"powder">>[] = [
  dateColumn(), batchColumn(), productColumn(),
  { key: "given", label: "Given to packing", numeric: true, cell: (r) => formatLossQuantity(r.given, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.given)) },
  { key: "lost", label: "Lost", numeric: true, cell: (r) => formatLossQuantity(r.lost, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.lost)) },
  { key: "percent", label: "Loss %", numeric: true, percent: true, cell: (r) => percentText(r.percent), total: (rows) => totalPercent(byUnit(rows, (r) => r.unit, (r) => r.lost), byUnit(rows, (r) => r.unit, (r) => r.given)) },
  costColumn(), reasonColumn(),
];
const PACKING: Column<LossRowOf<"packing">>[] = [
  dateColumn(), batchColumn(),
  { key: "material", label: "Material", cell: (r) => r.material },
  { key: "needed", label: "Needed / expected", numeric: true, cell: (r) => (r.shopper ? `${formatNumber(Number(r.needed))} expected` : formatNumber(Number(r.needed))) },
  { key: "used", label: "Used / actual", numeric: true, cell: (r) => (r.shopper ? `${formatNumber(Number(r.used))} made` : formatNumber(Number(r.used))) },
  { key: "loss", label: "Loss", numeric: true, cell: (r) => (r.checkWeight ? `${formatNumber(Number(r.loss))} · check weight` : formatNumber(Number(r.loss))) },
  { key: "percent", label: "Loss %", numeric: true, percent: true, cell: (r) => percentText(r.percent) },
  costColumn(), reasonColumn(),
];
const STORE: Column<LossRowOf<"store">>[] = [
  dateColumn(),
  { key: "store", label: "Store", cell: (r) => r.store },
  { key: "material", label: "Material", cell: (r) => r.material },
  { key: "lot", label: "Lot", cell: (r) => `Rs ${formatNumber(Number(r.lotPrice))}/${unitLabel(r.unit)}` },
  { key: "quantity", label: "Quantity", numeric: true, cell: (r) => formatLossQuantity(r.quantity, r.unit) },
  costColumn(), reasonColumn(),
  { key: "by", label: "By", cell: (r) => r.by },
];
const COLUMNS = { batch: BATCH, chemical: CHEMICAL, powder: POWDER, packing: PACKING, store: STORE };
export function lossColumns(tab: LossTab): LossColumn[] {
  return COLUMNS[tab] as unknown as LossColumn[];
}

export type LossSummaryItem = { label: string; value: string };
export function lossSummary(tab: LossTab, rows: LossRow[]): LossSummaryItem[] {
  const cost = { label: "Loss cost", value: rupees(sumCost(rows)) };
  if (tab === "batch") {
    const r = rows as LossRowOf<"batch">[];
    const target = byUnit(r, (x) => x.unit, (x) => x.target);
    const loss = byUnit(r, (x) => x.unit, (x) => x.loss);
    const lossText = [...loss].map(([unit, sum]) => `${formatLossQuantity(sum, unit)} (${percentText(lossPercent(sum, target.get(unit) ?? 0))})`).join(" · ");
    return [
      { label: "Target", value: byUnitText(target) || "—" }, { label: "Actual", value: byUnitText(byUnit(r, (x) => x.unit, (x) => x.actual)) || "—" },
      { label: "Loss", value: lossText || "—" }, cost,
    ];
  }
  if (tab === "chemical") {
    const r = rows as LossRowOf<"chemical">[];
    return [{ label: "Extra used", value: byUnitText(byUnit(r, (x) => x.unit, (x) => x.extra)) || "—" }, cost, { label: "Most-lost chemical", value: mostLost(r, (x) => x.chemical) }];
  }
  if (tab === "powder") {
    const r = rows as LossRowOf<"powder">[];
    const given = byUnit(r, (x) => x.unit, (x) => x.given);
    const lost = byUnit(r, (x) => x.unit, (x) => x.lost);
    const percent = [...lost].map(([unit, sum]) => percentText(lossPercent(sum, given.get(unit) ?? 0))).join(" · ");
    return [{ label: "Given to packing", value: byUnitText(given) || "—" }, { label: "Lost", value: byUnitText(lost) || "—" }, { label: "Loss %", value: percent || "—" }, cost];
  }
  if (tab === "packing") {
    const r = rows as LossRowOf<"packing">[];
    const shoppers = r.filter((x) => x.shopper).map((x) => ({ expected: Number(x.needed), loss: Number(x.loss), checkWeight: x.checkWeight }));
    // The material name without the " (1.20 KG)" suffix shoppers carry.
    const name = (x: LossRowOf<"packing">) => (x.shopper ? x.material.replace(/ \([\d.]+ KG\)$/, "") : x.material);
    return [cost, { label: "Shopper loss %", value: percentText(weightedShopperPercent(shoppers)) }, { label: "Most-lost material", value: mostLost(r, name) }];
  }
  const r = rows as LossRowOf<"store">[];
  const byReason = new Map<string, Big>();
  for (const x of r) byReason.set(x.reasonName, (byReason.get(x.reasonName) ?? new Big(0)).plus(x.cost));
  return [cost, { label: "By reason", value: [...byReason].map(([reason, sum]) => `${reason} ${rupees(sum)}`).join(" · ") || "—" }];
}

export type LossFilterKey = "productId" | "formulaId" | "chemicalId" | "materialId" | "storeId" | "reason";
export type LossFilters = Partial<Record<LossFilterKey, string>>;
export const LOSS_FILTER_KEYS: Record<LossTab, LossFilterKey[]> = {
  batch: ["productId", "formulaId", "reason"], chemical: ["chemicalId", "productId", "reason"], powder: ["productId", "reason"],
  packing: ["materialId", "productId", "reason"], store: ["storeId", "materialId", "reason"],
};
const FILTER_LABELS: Record<LossFilterKey, string> = { productId: "Product", formulaId: "Formula", chemicalId: "Chemical", materialId: "Material", storeId: "Store", reason: "Reason" };
export type LossFilterOption = { key: LossFilterKey; label: string; options: { value: string; label: string }[] };

function filterValue(row: LossRow, key: LossFilterKey): { value: string; label: string } | null {
  if (key === "reason") return row.reasonCode ? { value: row.reasonCode, label: row.reasonName } : null;
  if (key === "productId") return "productId" in row ? { value: row.productId, label: row.product } : null;
  if (key === "formulaId") return row.tab === "batch" ? { value: row.formulaId, label: row.formula } : null;
  if (key === "chemicalId") return row.tab === "chemical" ? { value: row.chemicalId, label: row.chemical } : null;
  if (key === "storeId") return row.tab === "store" ? { value: row.storeId, label: row.store } : null;
  if (row.tab === "packing") return { value: row.materialId, label: row.material.replace(/ \([\d.]+ KG\)$/, "") };
  return row.tab === "store" ? { value: row.materialId, label: row.material } : null;
}

export function lossFilterOptions(tab: LossTab, rows: LossRow[]): LossFilterOption[] {
  return LOSS_FILTER_KEYS[tab].map((key) => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const found = filterValue(row, key);
      if (found) seen.set(found.value, found.label);
    }
    const options = [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    return { key, label: FILTER_LABELS[key], options };
  });
}

export function filterLossRows(tab: LossTab, rows: LossRow[], filters: LossFilters, onlyOverLimit: boolean) {
  return rows.filter((row) =>
    LOSS_FILTER_KEYS[tab].every((key) => !filters[key] || filterValue(row, key)?.value === filters[key]) && (!onlyOverLimit || row.over));
}

export function lossFiltersText(tab: LossTab, filters: LossFilters, options: LossFilterOption[]) {
  return LOSS_FILTER_KEYS[tab].map((key) => {
    const option = options.find((o) => o.key === key);
    const chosen = filters[key] ? option?.options.find((o) => o.value === filters[key])?.label : undefined;
    return `${FILTER_LABELS[key]} ${chosen ?? "All"}`;
  }).join(" · ");
}

export function lossStripTotals(rowsByTab: Record<LossTab, LossRow[]>) {
  const totals = Object.fromEntries(LOSS_TABS.map((tab) => [tab, sumCost(rowsByTab[tab])])) as Record<LossTab, string>;
  return { ...totals, total: sumMoney(Object.values(totals)) };
}

export function pageLossRows(rows: LossRow[], page: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / LOSS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  return { rows: rows.slice((current - 1) * LOSS_PAGE_SIZE, current * LOSS_PAGE_SIZE), page: current, pageCount };
}
