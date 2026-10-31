import Big from "big.js";
import { packagingUnit } from "@/lib/inventory/material-units";
import { ADJUSTMENT_REASONS, MIXING_REASONS, PACKING_REASONS, POWDER_LOSS_REASONS, reasonLabel } from "./material-use";

export const LOSS_TABS = ["batch", "chemical", "powder", "packing", "store"] as const;
export type LossTab = (typeof LOSS_TABS)[number];
export const LOSS_TAB_LABELS: Record<LossTab, string> = {
  batch: "Batch loss", chemical: "Chemical loss", powder: "Powder loss", packing: "Packing material loss", store: "Store & floor loss",
};
export const LOSS_STRIP_LABELS: Record<LossTab, string> = {
  batch: "Batch", chemical: "Chemical", powder: "Powder", packing: "Packing", store: "Store/floor",
};

export const LOSS_LIMIT_KEYS = ["batch", "chemical", "powder", "shopper", "otherPacking"] as const;
export type LossLimitKey = (typeof LOSS_LIMIT_KEYS)[number];
export type LossLimits = Record<LossLimitKey, string>;
export const LOSS_LIMIT_LABELS: Record<LossLimitKey, string> = {
  batch: "Batch loss", chemical: "Chemical loss", powder: "Powder loss", shopper: "Shopper loss", otherPacking: "Other packing material",
};
export const DEFAULT_LOSS_LIMITS: LossLimits = { batch: "10.0", chemical: "10.0", powder: "10.0", shopper: "10.0", otherPacking: "10.0" };
// A limit is 0 to 100 with at most one decimal place.
export function isValidLossLimit(value: string) {
  const limit = value.trim();
  return /^\d{1,3}(?:\.\d)?$/.test(limit) && new Big(limit).lte(100);
}
export const LOSS_LIMIT_ERROR = "Use 0 to 100, with up to one decimal place.";
// Shopper rows have no typed reason; they filter as "Measured".
export const MEASURED_REASON = "measured";

// Stock removals that count as loss. "count_over" only ever adds stock.
export const STORE_LOSS_REASONS = ["damaged", "spilled", "expired", "count_short", "other"] as const;
export const LOSS_PAGE_SIZE = 25;
export const LOSS_PRINT_MAX_ROWS = 2000;
export const TOO_MANY_TO_PRINT = "Too many rows to print. Narrow the date range or filters.";

const money = (value: Big) => value.round(2, Big.roundHalfUp).toFixed(2);
const qty = (value: Big) => value.toFixed(3);

export function lossPercent(loss: Big.BigSource, base: Big.BigSource): string | null {
  const total = new Big(base);
  if (total.lte(0)) return null;
  return new Big(loss).times(100).div(total).round(1, Big.roundHalfUp).toFixed(1);
}

// Strictly above: 10.0% at a 10% limit is not red.
export function isOverLimit(percent: string | null, limit: string) {
  return percent !== null && new Big(percent).gt(limit);
}

export function batchLoss(input: { target: string; actual: string; chemicalCost: string }) {
  const target = new Big(input.target);
  const loss = target.minus(input.actual);
  const cost = target.gt(0) ? loss.times(input.chemicalCost).div(target) : new Big(0);
  return { loss: qty(loss), percent: lossPercent(loss, target), cost: money(cost) };
}

export function chemicalLoss(input: { formula: string; used: string; extraCost: string }) {
  const extra = new Big(input.used).minus(input.formula);
  return { extra: qty(extra), percent: lossPercent(extra, input.formula), cost: money(new Big(input.extraCost)) };
}

export function powderLoss(input: { packed: string; lost: string; costPerUnit: string }) {
  const given = new Big(input.packed).plus(input.lost);
  return { given: qty(given), percent: lossPercent(input.lost, given), cost: money(new Big(input.lost).times(input.costPerUnit)) };
}

// lossCost is the saved cost of lost shoppers. More packs than expected is a weight problem, not a gain.
export function shopperLoss(input: { expected: number; actual: number; lossCost: string }) {
  const loss = input.expected - input.actual;
  const checkWeight = loss < 0;
  return { loss, percent: lossPercent(loss, input.expected), cost: checkWeight ? "0.00" : money(new Big(input.lossCost)), checkWeight };
}

export function piecesLoss(input: { needed: string; used: string; extraCost: string }) {
  const loss = new Big(input.used).minus(input.needed);
  return { loss: qty(loss), percent: lossPercent(loss, input.needed), cost: money(new Big(input.extraCost)) };
}

export function weightedShopperPercent(rows: { expected: number; loss: number; checkWeight: boolean }[]) {
  const counted = rows.filter((row) => !row.checkWeight);
  return lossPercent(counted.reduce((sum, row) => sum + row.loss, 0), counted.reduce((sum, row) => sum + row.expected, 0));
}

export function sumMoney(values: string[]) {
  return money(values.reduce((sum, value) => sum.plus(value), new Big(0)));
}

// ── Report rows ─────────────────────────────────────────────────────────────

export type LossRowLink = { kind: "run"; runId: string } | { kind: "item"; itemType: "chemical" | "packaging"; itemId: string };
type RowBase = { id: string; date: string; reasonCode: string | null; reasonName: string; reason: string; over: boolean; link: LossRowLink };
type RunFields = { batchId: string; productId: string; product: string };

export type BatchLossRow = RowBase & RunFields & { tab: "batch"; formulaId: string; formula: string; unit: string; target: string; actual: string; loss: string; percent: string | null; cost: string };
export type ChemicalLossRow = RowBase & RunFields & { tab: "chemical"; chemicalId: string; chemical: string; unit: string; formula: string; used: string; extra: string; percent: string | null; cost: string };
export type PowderLossRow = RowBase & RunFields & { tab: "powder"; unit: string; given: string; lost: string; percent: string | null; cost: string };
export type PackingLossRow = RowBase & RunFields & { tab: "packing"; materialId: string; material: string; shopper: boolean; needed: string; used: string; loss: string; percent: string | null; cost: string; checkWeight: boolean };
export type StoreLossRow = RowBase & { tab: "store"; storeId: string; store: string; materialId: string; material: string; unit: string; lotPrice: string; quantity: string; cost: string; by: string };
export type LossRow = BatchLossRow | ChemicalLossRow | PowderLossRow | PackingLossRow | StoreLossRow;
export type LossRowOf<T extends LossTab> = Extract<LossRow, { tab: T }>;

type RunQueryFields = { runId: string; batchId: string; date: Date; productId: string; product: string };
export type BatchQueryRow = RunQueryFields & { target: string; actual: string; unit: string; chemicalCost: string; reasonCode: string | null; note: string | null; formulaId: string; formula: string };
export type ChemicalQueryRow = RunQueryFields & { useId: string; chemicalId: string; chemical: string; unit: string; formula: string; used: string; extraCost: string; reasonCode: string | null; note: string | null };
export type PowderQueryRow = RunQueryFields & { receiptId: string; unit: string; packed: string; lost: string; costPerUnit: string; reasonCode: string | null; note: string | null };
export type PackingQueryRow = RunQueryFields & { useId: string; materialId: string; material: string; measuredInKg: boolean; needed: string; used: string; extraQuantity: string; extraCost: string; reasonCode: string | null; note: string | null; expectedShoppers: number | null; actualShoppers: number | null; lossShoppers: number | null };
export type StoreQueryRow = { id: string; date: Date; storeId: string; store: string; materialType: string; chemicalId: string | null; chemicalName: string | null; chemicalUnit: string | null; packagingId: string | null; packagingName: string | null; measuredInKg: boolean | null; lotPrice: string; delta: string; value: string; reasonCode: string; note: string | null; by: string };

type ReasonList = readonly { code: string; label: string }[];
// Label plus a quoted note. Old batches have only free text and no code.
function reasonText(list: ReasonList, code: string | null, note: string | null) {
  const name = code ? reasonLabel(list, code) : "";
  if (!name) return { reasonName: "", reason: note?.trim() ?? "" };
  return { reasonName: name, reason: note?.trim() ? `${name} · "${note.trim()}"` : name };
}
const runFields = (row: RunQueryFields) => ({
  batchId: row.batchId, productId: row.productId, product: row.product, date: row.date.toISOString(), link: { kind: "run" as const, runId: row.runId },
});

export function toBatchRow(row: BatchQueryRow, limits: LossLimits): BatchLossRow {
  const loss = batchLoss({ target: row.target, actual: row.actual, chemicalCost: row.chemicalCost });
  return {
    tab: "batch", id: row.runId, ...runFields(row), ...reasonText(MIXING_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode,
    formulaId: row.formulaId, formula: row.formula, unit: row.unit, target: row.target, actual: row.actual, ...loss, over: isOverLimit(loss.percent, limits.batch),
  };
}

export function toChemicalRow(row: ChemicalQueryRow, limits: LossLimits): ChemicalLossRow {
  const loss = chemicalLoss({ formula: row.formula, used: row.used, extraCost: row.extraCost });
  return {
    tab: "chemical", id: row.useId, ...runFields(row), ...reasonText(MIXING_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode,
    chemicalId: row.chemicalId, chemical: row.chemical, unit: row.unit, formula: row.formula, used: row.used, ...loss, over: isOverLimit(loss.percent, limits.chemical),
  };
}

export function toPowderRow(row: PowderQueryRow, limits: LossLimits): PowderLossRow {
  const loss = powderLoss({ packed: row.packed, lost: row.lost, costPerUnit: row.costPerUnit });
  return {
    tab: "powder", id: row.receiptId, ...runFields(row), ...reasonText(POWDER_LOSS_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode,
    unit: row.unit, lost: row.lost, ...loss, over: isOverLimit(loss.percent, limits.powder),
  };
}

export function toPackingRow(row: PackingQueryRow, limits: LossLimits): PackingLossRow {
  const common = { tab: "packing" as const, id: row.useId, ...runFields(row), materialId: row.materialId };
  if (row.measuredInKg) {
    const loss = shopperLoss({ expected: row.expectedShoppers ?? 0, actual: row.actualShoppers ?? 0, lossCost: row.extraCost });
    return {
      ...common, material: `${row.material} (${new Big(row.used).toFixed(2)} KG)`, shopper: true,
      needed: String(row.expectedShoppers ?? 0), used: String(row.actualShoppers ?? 0), loss: String(loss.loss), percent: loss.percent, cost: loss.cost,
      checkWeight: loss.checkWeight, reasonCode: MEASURED_REASON, reasonName: "Measured", reason: "Measured",
      over: !loss.checkWeight && isOverLimit(loss.percent, limits.shopper),
    };
  }
  const loss = piecesLoss({ needed: row.needed, used: row.used, extraCost: row.extraCost });
  return {
    ...common, material: row.material, shopper: false, needed: row.needed, used: row.used, ...loss, checkWeight: false,
    ...reasonText(PACKING_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode, over: isOverLimit(loss.percent, limits.otherPacking),
  };
}

export function toStoreRow(row: StoreQueryRow, _limits: LossLimits): StoreLossRow {
  const chemical = row.materialType === "chemical";
  const materialId = (chemical ? row.chemicalId : row.packagingId) ?? "";
  return {
    tab: "store", id: row.id, date: row.date.toISOString(), storeId: row.storeId, store: row.store, materialId,
    material: (chemical ? row.chemicalName : row.packagingName) ?? "",
    unit: chemical ? (row.chemicalUnit ?? "") : packagingUnit({ measuredInKg: row.measuredInKg }),
    lotPrice: row.lotPrice, quantity: new Big(row.delta).abs().toFixed(3), cost: money(new Big(row.value).abs()), by: row.by,
    ...reasonText(ADJUSTMENT_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode, over: false,
    link: { kind: "item", itemType: chemical ? "chemical" : "packaging", itemId: materialId },
  };
}
