import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { invoicePaymentInputSchema } from "@/db/zod_schemas";

describe("customer-credit-fn & settlement server contracts", () => {
  it("gates customer credit summary, refund issuance, and refund reversal with exact middlewares and dynamic db imports", () => {
    const fnSource = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/customer-credit-fn.ts"),
      "utf8",
    );
    expect(fnSource).not.toContain('import { db } from "@/db"');
    expect(fnSource).toContain('await import("@/db")');
    expect(fnSource).toContain("requireSalesViewMiddleware");
    expect(fnSource).toContain("requireFinanceRefundsIssueMiddleware");
    expect(fnSource).toContain("requireFinancePaymentReversalOrManageMiddleware");
    expect(fnSource).toContain("issueCustomerRefund(tx,");
    expect(fnSource).toContain("reverseCustomerRefund(tx,");
  });

  it("validates customer_credit invoice payment rows without requiring walletId", () => {
    const parsed = invoicePaymentInputSchema.parse({
      method: "customer_credit",
      amount: 1500,
      paymentDate: "2026-11-11T10:00:00Z",
    });
    expect(parsed.method).toBe("customer_credit");
    expect(parsed.walletId).toBeUndefined();
  });

  it("wires credit note counter and split logic into sales-returns-fn and settlement-service", () => {
    const returnsFn = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/sales-returns-fn.ts"),
      "utf8",
    );
    const settlement = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/settlement-service.ts"),
      "utf8",
    );
    const posting = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/invoice-posting-service.ts"),
      "utf8",
    );

    expect(returnsFn).toContain("allocateNextCreditNoteNumber");
    expect(returnsFn).toContain("computeReturnCreditSplit");
    expect(returnsFn).toContain("issueCustomerCreditFromReturn");
    expect(returnsFn).toContain("voidReturnCreditSettlement");
    expect(returnsFn).toContain("allowUnapplyOverageOnReturnVoid: true");

    expect(settlement).toContain("applyCustomerCreditToPayment");
    expect(settlement).toContain("restoreCustomerCreditForReversedPayment");
    expect(settlement).toContain("issuePaymentOverageCredit");
    expect(settlement).toContain("reclaimPaymentOverageCredit");
    expect(settlement).toContain("reclaimInvoiceReturnCreditForPaymentReversal");
    expect(settlement).not.toContain('throw new Error("Returned Amount cannot exceed invoice total")');

    expect(posting).toContain('payment.method === "customer_credit"');
  });
});
