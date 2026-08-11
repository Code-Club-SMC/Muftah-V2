import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/server-functions/sales/offline-review-fn.ts"),
  "utf8",
);

describe("offline sales review", () => {
  it("refreshes live references without editing signed business values", () => {
    expect(source).toContain("refreshOfflineSalesPreview");
    expect(source).toContain("finishedGoodsStock");
    expect(source).toContain("creditLimitExceeded");
    expect(source).not.toMatch(
      /baseCartonPrice:\s*data|cartonQuantity:\s*data|customerId:\s*data/,
    );
  });

  it("allows warning acknowledgement and same-type wallet recovery only", () => {
    expect(source).toContain(
      'eq(offlineSalesStagedInvoices.status, "warning")',
    );
    expect(source).toContain("Available wallets cannot be replaced");
    expect(source).toContain(
      "Replacement wallet must have the same payment type",
    );
    expect(source).toContain("listOfflineSalesReplacementWalletsFn");
  });

  it("requires an explicit safe order-conflict resolution", () => {
    expect(source).toContain("same_dispatch_duplicate");
    expect(source).toContain("replace_incorrect_online");
    expect(source).toContain("second_physical_dispatch");
    expect(source).toContain(
      "Reverse or void the incorrect online invoice first",
    );
    expect(source).toContain("no second order commission");
    expect(source).toContain("orderInvoiceCandidates");
    expect(source).toContain("issueDetails: invoice.issueDetails");
  });

  it("keeps exported review helpers on the server boundary", () => {
    expect(source).toContain("createServerOnlyFn");
    expect(source).toContain(
      "export const refreshOfflineSalesPreview = createServerOnlyFn",
    );
    expect(source).toContain(
      "export const getOfflineSalesBatchDetail = createServerOnlyFn",
    );
    expect(source).not.toMatch(
      /export async function (refreshOfflineSalesPreview|getOfflineSalesBatchDetail)/,
    );
  });
});
