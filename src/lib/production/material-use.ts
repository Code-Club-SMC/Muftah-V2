import Big from "big.js";
import { lotQuantity, type LotBalance } from "@/lib/inventory/material-lots";

type Reason = { readonly code: string; readonly label: string };

export const MIXING_REASONS = [
  { code: "spill", label: "Spill" },
  { code: "leak", label: "Leak" },
  { code: "measuring_error", label: "Measuring error" },
  { code: "machine_fault", label: "Machine fault" },
  { code: "moisture_loss", label: "Moisture loss" },
  { code: "other", label: "Other" },
] as const;
export const PACKING_REASONS = [
  { code: "broken", label: "Broken" },
  { code: "torn", label: "Torn" },
  { code: "misprint", label: "Misprint" },
  { code: "machine_fault", label: "Machine fault" },
  { code: "other", label: "Other" },
] as const;
export const POWDER_LOSS_REASONS = [
  { code: "spill", label: "Spill" },
  { code: "machine_fault", label: "Machine fault" },
  { code: "stuck_in_machine", label: "Stuck in machine" },
  { code: "other", label: "Other" },
] as const;
export const ADJUSTMENT_REASONS = [
  { code: "damaged", label: "Damaged" },
  { code: "spilled", label: "Spilled" },
  { code: "expired", label: "Expired" },
  { code: "count_short", label: "Count short" },
  { code: "count_over", label: "Count over" },
  { code: "other", label: "Other" },
] as const;

export const SHOPPER_OVER_WARNING = "More packs than this weight should give. Check the shopper weight in material setup.";

export function reasonCodes<T extends readonly Reason[]>(list: T) {
  return list.map((reason) => reason.code) as unknown as [T[number]["code"], ...T[number]["code"][]];
}

export function reasonLabel(list: readonly Reason[], code: string | null | undefined) {
  return list.find((reason) => reason.code === code)?.label ?? code ?? "";
}

export function checkReason(list: readonly Reason[], code: string | null | undefined, note: string | null | undefined, what: string) {
  if (!code) return `Pick a reason for ${what}`;
  if (!list.some((reason) => reason.code === code)) return `Pick a reason from the list for ${what}`;
  if (code === "other" && !note?.trim()) return `Write a note for "Other" on ${what}`;
  return null;
}

const ADDING = new Set(["count_over", "other"]);
export function adjustmentReasonsFor(adding: boolean) {
  return ADJUSTMENT_REASONS.filter((reason) => (adding ? ADDING.has(reason.code) : reason.code !== "count_over"));
}

export function checkAdjustmentReason(code: string | null | undefined, note: string | null | undefined, adding: boolean) {
  const error = checkReason(ADJUSTMENT_REASONS, code, note, "this adjustment");
  if (error) return error;
  if (!adjustmentReasonsFor(adding).some((reason) => reason.code === code))
    return `${reasonLabel(ADJUSTMENT_REASONS, code)} can't be used when ${adding ? "adding" : "removing"} stock`;
  return null;
}

export function mixingUseChange(formula: string, used: string) {
  const diff = new Big(lotQuantity(used, "Used")).minus(formula);
  if (diff.gt(0)) return { kind: "extra" as const, quantity: diff.toFixed(3) };
  if (diff.lt(0)) return { kind: "leftover" as const, quantity: diff.abs().toFixed(3) };
  return { kind: "same" as const, quantity: "0.000" };
}

export function checkPiecesUse(input: { name: string; needed: string; used: string; reason?: string | null; note?: string | null }) {
  let used: Big;
  try { used = new Big(lotQuantity(input.used)); } catch { return [`${input.name}: enter the quantity used as a number with up to 3 decimals`]; }
  if (used.lt(input.needed)) return [`${input.name}: used can't be less than needed (${new Big(input.needed).toString()}). Check the pack count instead.`];
  if (used.gt(input.needed)) {
    const error = checkReason(PACKING_REASONS, input.reason, input.note, `extra ${input.name}`);
    return error ? [error] : [];
  }
  return [];
}

export function shopperNumbers(input: { kgUsed: string; gramsPerShopper: string; actualPacks: number }) {
  const grams = new Big(input.gramsPerShopper || 0);
  if (grams.lte(0)) throw new Error("Set the weight of one shopper in material setup");
  let kg: Big;
  try { kg = new Big(lotQuantity(input.kgUsed, "KG used")); } catch { throw new Error("Enter the KG of shopper used"); }
  if (kg.lte(0)) throw new Error("Enter the KG of shopper used");
  const expected = kg.times(1000).div(grams).round(0, Big.roundDown).toNumber();
  const loss = expected - input.actualPacks;
  const lossPercent = expected > 0 ? new Big(loss).times(100).div(expected).round(1, Big.roundHalfUp).toFixed(1) : "0.0";
  return { expected, actual: input.actualPacks, loss, lossPercent, moreThanExpected: loss < 0 };
}

// What one batch took at start, per chemical, in the order it took it.
export function groupFormulaUse(rows: { chemicalId: string; lotId: string; quantity: string; unitPrice: string; firstPurchasedAt: Date | string }[]) {
  const grouped = new Map<string, { formula: string; takenLots: LotBalance[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.chemicalId) ?? { formula: "0.000", takenLots: [] };
    entry.formula = new Big(entry.formula).plus(row.quantity).toFixed(3);
    const lot = entry.takenLots.find((item) => item.lotId === row.lotId);
    if (lot) lot.quantity = new Big(lot.quantity).plus(row.quantity).toFixed(3);
    else entry.takenLots.push({ lotId: row.lotId, quantity: new Big(row.quantity).toFixed(3), unitPrice: row.unitPrice, firstPurchasedAt: row.firstPurchasedAt });
    grouped.set(row.chemicalId, entry);
  }
  return grouped;
}
