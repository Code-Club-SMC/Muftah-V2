// src/lib/inventory/by-products.ts
import Big from "big.js";

export type ByProductInput = { byProductTracked?: boolean; containerName?: string; containerSize?: string };
export type EmptiesPurchase = {
  quantity: string;
  byProductTracked: boolean;
  containerName: string | null;
  containerSize: string | null;
};
export type EarnedEntry = { containerName: string; containerSize: string; earned: number };

/** "  plastic   DRUM " becomes "Plastic Drum", so one container is never saved under two spellings. */
export function normalizeContainerName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

function toBig(value: string | number): Big | null {
  try {
    return new Big(value);
  } catch {
    return null;
  }
}

/** Number of whole containers in a quantity, or null when it is not a whole number or size is not above zero. */
export function containerCount(quantity: string | number, size: string | number): number | null {
  const qty = toBig(quantity);
  const each = toBig(size);
  if (!qty || !each || !each.gt(0)) return null;
  const count = qty.div(each);
  return count.round(0, Big.roundDown).eq(count) ? Number(count.toFixed(0)) : null;
}

/** Columns saved on a purchase. Throws a user-facing message on bad input. */
export function byProductColumns(input: ByProductInput, quantity: string) {
  if (!input.byProductTracked) return { byProductTracked: false, containerName: null, containerSize: null };
  const containerName = normalizeContainerName(input.containerName ?? "");
  if (!containerName) throw new Error("Please enter the container name");
  if (containerName.length > 40) throw new Error("Container name is too long");
  const size = toBig((input.containerSize ?? "").trim() || "x");
  if (!size || !size.gt(0) || !size.round(3).eq(size) || size.gt("999999999.999")) {
    throw new Error("Container size must be above zero with at most 3 decimals");
  }
  if (containerCount(quantity, size.toString()) === null) {
    throw new Error(`Quantity must be a whole number of containers (${size.toString()} each)`);
  }
  return { byProductTracked: true, containerName, containerSize: size.toFixed(3) };
}

export function containerKey(name: string, size: string | number): string {
  return `${name}|${new Big(size).toFixed(3)}`;
}

/**
 * Empties earned per container for one stock item. Oldest stock is used first, so whatever is still
 * in stock belongs to the newest purchases. `purchases` must be oldest first.
 */
export function earnedEmpties(input: { inStock: string; purchases: EmptiesPurchase[] }): Map<string, EarnedEntry> {
  const result = new Map<string, EarnedEntry>();
  let left = new Big(input.inStock);
  if (left.lt(0)) left = new Big(0);
  for (let i = input.purchases.length - 1; i >= 0; i--) {
    const purchase = input.purchases[i];
    const quantity = new Big(purchase.quantity);
    const kept = left.gt(quantity) ? quantity : left;
    left = left.minus(kept);
    if (!purchase.byProductTracked || !purchase.containerName || !purchase.containerSize) continue;
    const used = quantity.minus(kept);
    const empties = Number(used.div(purchase.containerSize).round(0, Big.roundDown).toFixed(0));
    const key = containerKey(purchase.containerName, purchase.containerSize);
    const entry = result.get(key) ?? {
      containerName: purchase.containerName,
      containerSize: new Big(purchase.containerSize).toFixed(3),
      earned: 0,
    };
    entry.earned += empties;
    result.set(key, entry);
  }
  return result;
}

export function byProductLabel(itemName: string, unit: string, containerName: string, containerSize: string | number): string {
  return `${itemName} – ${Number(containerSize)}${unit} ${containerName}`;
}

/** Saved chemical pack size like "100kg" or "20 L" gives "100" / "20". Anything else gives "". */
export function sizeFromPackagingText(text: string | null | undefined): string {
  const match = (text ?? "").trim().match(/^(\d+(?:\.\d+)?)/);
  return match ? match[1] : "";
}
