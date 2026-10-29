// src/lib/inventory/material-lots.ts
import Big from "big.js";
import { format } from "date-fns";
import { z } from "zod";

export type MaterialType = "chemical" | "packaging";
export type MaterialRef = { materialType: MaterialType; materialId: string };
export type LotPick = { lotId: string; quantity: string };
export type LotBalance = { lotId: string; unitPrice: string; quantity: string; firstPurchasedAt: Date | string };
export type PickedLot = { lotId: string; quantity: string; unitPrice: string; totalCost: string };

export const PURCHASE_LOCKED_MESSAGE =
  "Some of this stock has already been used or moved, so the quantity and price can't change. Old batch costs would become wrong.";

export const lotPickSchema = z.object({
  lotId: z.string().min(1),
  quantity: z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, "Use a number with up to 3 decimals"),
});
export const materialLotPicksSchema = z.object({
  materialId: z.string().min(1),
  picks: z.array(lotPickSchema).min(1).max(50),
});
export type MaterialLotPicks = z.infer<typeof materialLotPicksSchema>;

export function lotPrice(value: string | number | Big) {
  const price = new Big(value);
  if (price.lt(0)) throw new Error("Price cannot be negative");
  return price.round(2, Big.roundHalfUp).toFixed(2);
}

export function lotQuantity(value: string, label = "Quantity") {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error(`${label} must be a nonnegative number`);
  const quantity = new Big(value.trim());
  if (!quantity.round(3).eq(quantity) || quantity.gt("999999999.999")) throw new Error(`${label} must use at most 3 decimals`);
  return quantity.toFixed(3);
}

const plain = (value: Big | string) => new Big(value).toString();

export function checkLotPicks(input: { name: string; unit: string; required: string; picks: LotPick[]; balances: LotBalance[] }) {
  const { name, unit } = input;
  const errors: string[] = [];
  const seen = new Set<string>();
  let total = new Big(0);
  for (const pick of input.picks) {
    let quantity: Big;
    try { quantity = new Big(lotQuantity(pick.quantity)); } catch { errors.push(`${name}: enter each lot quantity as a number with up to 3 decimals`); continue; }
    if (quantity.lte(0)) { errors.push(`${name}: each picked quantity must be more than zero`); continue; }
    if (seen.has(pick.lotId)) { errors.push(`${name}: pick each lot only once`); continue; }
    seen.add(pick.lotId);
    const balance = input.balances.find((row) => row.lotId === pick.lotId);
    if (!balance || new Big(balance.quantity).lte(0)) { errors.push(`${name}: one picked lot has no stock here`); continue; }
    if (quantity.gt(balance.quantity)) errors.push(`${name}: lot Rs ${balance.unitPrice} has only ${plain(balance.quantity)} ${unit} here`);
    total = total.plus(quantity);
  }
  if (!errors.length && !total.eq(input.required))
    errors.push(`${name}: lots add up to ${plain(total)} ${unit}, but ${plain(input.required)} ${unit} is needed`);
  return [...new Set(errors)];
}

export function costLotPicks(picks: LotPick[], balances: LotBalance[]): PickedLot[] {
  return picks.map((pick) => {
    const balance = balances.find((row) => row.lotId === pick.lotId);
    if (!balance) throw new Error("Picked lot not found");
    const quantity = lotQuantity(pick.quantity);
    return { lotId: pick.lotId, quantity, unitPrice: lotPrice(balance.unitPrice), totalCost: new Big(quantity).times(balance.unitPrice).round(2, Big.roundHalfUp).toFixed(2) };
  });
}

export function defaultLotPicks(required: string, balances: LotBalance[]): LotPick[] {
  const stocked = balances.filter((row) => new Big(row.quantity).gt(0));
  if (stocked.length !== 1 || new Big(stocked[0].quantity).lt(required) || new Big(required).lte(0)) return [];
  return [{ lotId: stocked[0].lotId, quantity: new Big(required).toFixed(3) }];
}

const PURCHASE_SOURCES = new Set(["purchase", "purchase_edit", "purchase_delete"]);

// movements: every lot movement in the purchase's store, starting with the purchase's own
// movement, oldest first. Newest purchases are treated as used last, so the purchase is
// untouched while the balance never dipped below the stock purchases brought in since it.
export function purchaseUntouched(input: { balanceNow: string; movements: { delta: string; sourceType: string }[] }) {
  let balance = input.movements.reduce((sum, row) => sum.minus(row.delta), new Big(input.balanceNow));
  let purchased = new Big(0);
  for (const movement of input.movements) {
    balance = balance.plus(movement.delta);
    if (PURCHASE_SOURCES.has(movement.sourceType)) purchased = purchased.plus(movement.delta);
    if (balance.lt(purchased)) return false;
  }
  return true;
}

export function normalizeMaterialName(name: string) {
  return name.toLowerCase().replace(/[\s\-._]+/g, "");
}

function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function isSimilarMaterialName(a: string, b: string) {
  const left = normalizeMaterialName(a);
  const right = normalizeMaterialName(b);
  return !!left && !!right && withinOneEdit(left, right);
}

export function lotLabel(lot: { unitPrice: string; firstPurchasedAt: Date | string }, unit: string) {
  const price = new Big(lot.unitPrice);
  const shown = price.round(0).eq(price) ? price.toFixed(0) : price.toFixed(2);
  return `Rs ${shown}/${unit} (first ${format(new Date(lot.firstPurchasedAt), "d MMM")})`;
}
