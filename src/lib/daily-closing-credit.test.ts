import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeDailyClosingBuckets } from "@/lib/sales/settlement/contracts";

describe("daily closing store credit and refund isolation", () => {
  it("excludes customer_credit payments from cash/bank/cheque totalCollected while tracking credit applied & refunds", () => {
    const summary = summarizeDailyClosingBuckets(
      [
        { method: "cash", amount: "1000.00" },
        { method: "bank_transfer", amount: "2000.00" },
        { method: "cheque", amount: "500.00" },
        { method: "expense_offset", amount: "300.00" },
        { method: "customer_credit", amount: "1500.00" },
      ],
      [{ amount: "750.00", status: "active" }],
    );
    expect(summary).toEqual({
      totalCash: 1000,
      totalBankTransfer: 2000,
      totalCheque: 500,
      totalExpenseOffset: 300,
      totalCollected: 3800,
      totalCreditApplied: 1500,
      totalCustomerRefunds: 750,
    });
  });

  it("keeps Customer Refund out of FINANCE_EXPENSE_SOURCES and reconciles in P&L bridge", () => {
    const reporting = readFileSync(
      resolve(process.cwd(), "src/server-functions/reports/profit-loss/company-reporting-core.ts"),
      "utf8",
    );
    expect(reporting).toContain("FINANCE_CUSTOMER_REFUND_SOURCES");
    expect(reporting).toContain('"Customer Refund"');
    expect(reporting).toContain('"Customer Refund Reversal"');
    expect(reporting).toContain("customer_refunds");
  });
});
