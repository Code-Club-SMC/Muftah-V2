export type OfflineInvoiceClassification =
  | "ready"
  | "warning"
  | "duplicate"
  | "invalid"
  | "needs_review";

export type OfflineClassificationInput = {
  parseIssueCodes: string[];
  identityState?: "new" | "same" | "changed";
  workbookStatus: "active" | "closed" | "force_retired";
  distributorUsable: boolean;
  productsUsable: boolean;
  walletsUsable: boolean;
  orderState: "not_applicable" | "usable" | "not_found" | "already_invoiced";
  hasStockShortage: boolean;
  creditHoldActive: boolean;
  creditLimitExceeded: boolean;
  staleSnapshot: boolean;
  /** A price was typed over the signed list at the desk. The office should look at it. */
  hasPriceOverride?: boolean;
  /** Other reasons for the office to look, such as a printed total that differs. */
  extraWarningCodes?: string[];
};

export type OfflineClassificationResult = {
  status: OfflineInvoiceClassification;
  issueCodes: string[];
};

export function classifyOfflineSalesInvoice(
  input: OfflineClassificationInput,
): OfflineClassificationResult {
  if (input.parseIssueCodes.length > 0) {
    return { status: "invalid", issueCodes: [...new Set(input.parseIssueCodes)] };
  }
  if (input.identityState === "same") {
    return { status: "duplicate", issueCodes: ["duplicate_identity"] };
  }
  if (input.identityState === "changed") {
    return { status: "needs_review", issueCodes: ["identity_content_changed"] };
  }
  const reviewCodes = [
    !input.distributorUsable ? "distributor_unavailable" : null,
    !input.productsUsable ? "product_unavailable" : null,
    !input.walletsUsable ? "wallet_unavailable" : null,
    input.orderState === "not_found" ? "order_not_found" : null,
    input.orderState === "already_invoiced" ? "order_already_invoiced" : null,
  ].filter((value): value is string => Boolean(value));
  if (reviewCodes.length > 0) {
    return { status: "needs_review", issueCodes: reviewCodes };
  }
  const warningCodes = [
    input.hasStockShortage ? "stock_shortage" : null,
    input.creditHoldActive ? "credit_hold_active" : null,
    input.creditLimitExceeded ? "credit_limit_exceeded" : null,
    input.hasPriceOverride ? "price_override" : null,
    ...(input.extraWarningCodes ?? []),
    input.staleSnapshot ? "stale_snapshot_context" : null,
    input.workbookStatus === "force_retired" ? "force_retired_workbook" : null,
  ].filter((value): value is string => Boolean(value));
  return warningCodes.length > 0
    ? { status: "warning", issueCodes: warningCodes }
    : { status: "ready", issueCodes: [] };
}

/**
 * Whether the invoice's customer can still be used.
 * - distributor sale: the signed distributor must still exist;
 * - retailer sale to an existing customer: that customer must still exist and
 *   must not have become a distributor;
 * - retailer sale to a new walk-in: always usable, the customer is created on posting;
 * - booked order: the order check covers it.
 */
export function isCustomerUsable(input: {
  saleType: "direct_distributor" | "direct_retailer" | "booked_order";
  hasSignedCustomer: boolean;
  liveCustomer: { customerType: string } | null | undefined;
}) {
  if (input.saleType === "booked_order") return true;
  if (input.saleType === "direct_distributor") return Boolean(input.liveCustomer);
  if (!input.hasSignedCustomer) return true;
  return Boolean(input.liveCustomer && input.liveCustomer.customerType !== "distributor");
}

/**
 * The paper copy shows the total the desk worked out. If the system works out a
 * different one, someone should look before the customer is billed.
 */
export function printedTotalDiffers(
  printedTotal: string | number | null | undefined,
  systemTotal: string | number,
) {
  if (printedTotal === null || printedTotal === undefined) return false;
  return Math.abs(Number(printedTotal) - Number(systemTotal)) > 0.005;
}
