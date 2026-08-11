import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const posting = readFileSync(resolve(process.cwd(), "src/lib/sales/offline/posting.server.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/server-functions/sales/invoice-posting-service.ts"), "utf8");
const commission = readFileSync(resolve(process.cwd(), "src/server-functions/sales/order-booker-commission-calc.ts"), "utf8");

describe("offline sales atomic posting", () => {
  it("locks identity, order, stock, and customer before posting", () => {
    expect(posting).toContain("FOR UPDATE");
    expect(posting).toContain('.for("update")');
    expect(posting.indexOf("offlineSalesInvoiceSlots.id")).toBeLessThan(posting.indexOf("finishedGoodsStock.id"));
  });

  it("uses signed prices, keeps stock non-negative, and creates deficits", () => {
    expect(service).toContain('pricingPolicy: "live" | "signed_snapshot"');
    expect(service).toContain('stockPolicy: "strict" | "offline_reconcile"');
    expect(service).toContain("Math.min(");
    expect(service).toContain("Math.max(0, currentRemainingUnits - r.deductedUnits)");
    expect(service).toContain("stockReconciliationIssues");
    expect(service).toContain("resolveInvoiceStockWarehouse");
    expect(service).toContain("Signed offline factory warehouse");
  });

  it("posts cash confirmed and transfer/cheque pending through settlement", () => {
    expect(service).toContain("createInitialPayments");
    expect(posting).toContain("sourceRecordId: payment.id");
    expect(posting).toContain('creditPolicy: "warn"');
  });

  it("uses outage dates for order delivery and commission", () => {
    expect(service).toContain("fulfilledAt: input.businessDate");
    expect(service).toContain("input.businessDate,");
    expect(commission).toContain("earnedAt");
    expect(posting).toContain('commissionPolicy: "suppress"');
  });

  it("processes at most twenty invoices and isolates failures", () => {
    expect(posting).toContain("OFFLINE_SALES_POST_LIMIT");
    expect(posting).toContain("for (const candidate of candidates)");
    expect(posting).toContain("await postOne(candidate.id");
    expect(posting).toContain('status: "needs_review"');
  });

  it("supports safe retries without exposing raw database errors", () => {
    expect(posting).toContain('existing.status === "completed"');
    expect(posting).toContain('"completed_with_issues"');
    expect(posting).toContain("safePostError(error)");
    expect(posting).toContain("Offline sales invoice posting failed");
  });
});
