import Big from "big.js";

/** Same ceiling as the amount column (numeric 12,2). */
export const MAX_OTHER_INCOME_AMOUNT = 9_999_999_999.99;

/** Ledger `transactions.source` for every Other Income money move. */
export const OTHER_INCOME_TX_SOURCE = "Other Income";

/** Quantity × price each, rounded to paisa. Throws when not above zero or too large for the column. */
export function otherIncomeAmount(quantity: string | number, unitPrice: string | number): string {
  const amount = new Big(quantity).times(unitPrice).round(2);
  if (!amount.gt(0)) throw new Error("Amount must be at least Rs 0.01");
  if (amount.gt(MAX_OTHER_INCOME_AMOUNT)) throw new Error("Amount is too large");
  return amount.toFixed(2);
}

/** "  SLES   drum " → "SLES drum", so the same item is not saved under two spellings. */
export function normalizeItemName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
