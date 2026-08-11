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
    input.staleSnapshot ? "stale_snapshot_context" : null,
    input.workbookStatus === "force_retired" ? "force_retired_workbook" : null,
  ].filter((value): value is string => Boolean(value));
  return warningCodes.length > 0
    ? { status: "warning", issueCodes: warningCodes }
    : { status: "ready", issueCodes: [] };
}
