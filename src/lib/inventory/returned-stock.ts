import Big from "big.js";

// Client-safe money rules for damaged and expired returned stock. No database access here.

export const RETURNED_CONDITIONS = ["damaged", "expired"] as const;
export type ReturnedCondition = (typeof RETURNED_CONDITIONS)[number];

export const RETURNED_STOCK_SALE_SOURCE = "Returned Stock Sale";
export const RETURNED_STOCK_SALE_REVERSAL_SOURCE = "Returned Stock Sale Reversal";

/** Value that received damaged/expired packs enter stock at, and the loss booked for them. */
export function salvageSplit(input: {
  label: string;
  units: number;
  salvagePerUnit: number | string;
  cost: string;
}): { stockValue: string; writeOff: string } {
  const salvage = new Big(input.salvagePerUnit || 0);
  if (salvage.lt(0)) throw new Error(`${input.label}: salvage value can't be below zero.`);
  const stockValue = salvage.times(input.units).round(2);
  const cost = new Big(input.cost);
  if (stockValue.gt(cost)) {
    throw new Error(
      `${input.label}: salvage value Rs ${stockValue.toFixed(2)} is more than what these ${input.units} packs cost (Rs ${cost.toFixed(2)}).`,
    );
  }
  return { stockValue: stockValue.toFixed(2), writeOff: cost.minus(stockValue).toFixed(2) };
}

/** Value that leaves a pooled stock row when `units` packs are taken out. */
export function poolShare(pool: { units: number; value: string }, units: number): string {
  if (!Number.isInteger(units) || units <= 0) throw new Error("Pick at least 1 pack.");
  if (units > pool.units) {
    throw new Error(`Only ${pool.units} ${pool.units === 1 ? "pack is" : "packs are"} in this stock.`);
  }
  const value = new Big(pool.value);
  return units === pool.units ? value.toFixed(2) : value.times(units).div(pool.units).round(2).toFixed(2);
}

/** New value and loss when a stock row is marked down to `valuePerPack`. Raising it is refused. */
export function writeDownAmount(
  pool: { units: number; value: string },
  valuePerPack: number | string,
): { newValue: string; writeDown: string } {
  if (pool.units <= 0) throw new Error("There are no packs left to value.");
  const perPack = new Big(valuePerPack || 0);
  if (perPack.lt(0)) throw new Error("Value per pack can't be below zero.");
  const current = new Big(pool.value);
  const newValue = perPack.times(pool.units).round(2);
  if (newValue.gt(current)) {
    throw new Error(
      `The new value (Rs ${newValue.toFixed(2)}) is above the current value (Rs ${current.toFixed(2)}). Value can only be lowered.`,
    );
  }
  if (newValue.eq(current)) throw new Error("The value is unchanged.");
  return { newValue: newValue.toFixed(2), writeDown: current.minus(newValue).toFixed(2) };
}

export function secondsSaleAmount(units: number, unitPrice: number | string): string {
  return new Big(unitPrice).times(units).round(2).toFixed(2);
}

export function returnedPacking(recipe: {
  cartonPackagingId: string | null;
  containersPerCarton: number | null;
}): { unitsPerCarton: number; usesCartons: boolean } {
  const perCarton = recipe.containersPerCarton ?? 0;
  return recipe.cartonPackagingId && perCarton > 0
    ? { unitsPerCarton: perCarton, usesCartons: true }
    : { unitsPerCarton: 1, usesCartons: false };
}

export const RETURNED_STOCK_MOVEMENT_KINDS = ["scrap", "seconds_sale", "revalue"] as const;
export type ReturnedStockMovementKind = (typeof RETURNED_STOCK_MOVEMENT_KINDS)[number];

export const RETURNED_STOCK_MOVEMENT_LABELS: Record<ReturnedStockMovementKind, string> = {
  scrap: "Scrapped",
  seconds_sale: "Sold as seconds",
  revalue: "Value lowered",
};

export type ReturnedStockMoneyEvent = { line: "write_off" | "write_down"; date: Date; amount: number };

/** Scrap and seconds feed "Return Write-offs"; value changes feed "Returned Stock Write-downs". */
export function returnedStockMoneyEvents(row: {
  kind: string;
  lossAmount: string | number;
  movementDate: Date;
  voidedAt: Date | null;
}): ReturnedStockMoneyEvent[] {
  const line = row.kind === "revalue" ? "write_down" : "write_off";
  const amount = Number(row.lossAmount);
  const events: ReturnedStockMoneyEvent[] = [{ line, date: row.movementDate, amount }];
  if (row.voidedAt) events.push({ line, date: row.voidedAt, amount: -amount });
  return events;
}
