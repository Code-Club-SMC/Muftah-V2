import Big from "big.js";

/** Same ceiling as the amount column (numeric 12,2). */
export const MAX_SALE_AMOUNT = 9_999_999_999.99;

/** Ledger `transactions.source` for every by-product sale money move. */
export const BY_PRODUCT_TX_SOURCE = "By-Products";

/** Quantity × price each, rounded to paisa. Throws when not above zero or too large for the column. */
export function saleAmount(quantity: string | number, unitPrice: string | number): string {
  const amount = new Big(quantity).times(unitPrice).round(2);
  if (!amount.gt(0)) throw new Error("Amount must be at least Rs 0.01");
  if (amount.gt(MAX_SALE_AMOUNT)) throw new Error("Amount is too large");
  return amount.toFixed(2);
}
