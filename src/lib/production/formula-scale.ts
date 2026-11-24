import Big from "big.js";

// The amount last typed for an ingredient, and the batch size it was typed for.
// Scaling always starts from here, so typing 2, 20, 200 does not add up rounding.
export type ScalableQuantity = {
  quantityPerBatch: string;
  typedQuantity: string;
  typedFor: string | null;
};

function positive(value: string | null) {
  try {
    const number = new Big(value ?? "");
    return number.gt(0) ? number : null;
  } catch {
    return null;
  }
}

export function typedQuantity(quantity: string, batchSize: string): ScalableQuantity {
  return { quantityPerBatch: quantity, typedQuantity: quantity, typedFor: positive(batchSize) ? batchSize : null };
}

// Keeps each ingredient's share of the batch. An empty or invalid size leaves the amounts alone.
export function scaleQuantity<T extends ScalableQuantity>(row: T, batchSize: string): T {
  const size = positive(batchSize);
  if (!size) return row;
  const from = positive(row.typedFor);
  const typed = positive(row.typedQuantity);
  if (!from) return { ...row, typedFor: batchSize };
  if (!typed) return row;
  if (size.eq(from)) return { ...row, quantityPerBatch: row.typedQuantity };
  return { ...row, quantityPerBatch: typed.times(size).div(from).round(3, Big.roundHalfUp).toString() };
}

export function batchPercent(quantity: string | Big, batchSize: string) {
  const size = positive(batchSize);
  const amount = positive(quantity.toString());
  return size && amount ? `${amount.times(100).div(size).round(2, Big.roundHalfUp).toString()}%` : null;
}

export function totalQuantity(quantities: string[]) {
  return quantities.reduce((total, quantity) => total.plus(positive(quantity) ?? 0), new Big(0));
}
