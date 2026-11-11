import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculatePaymentBreakdown, blankPayment } from "@/components/sales/create-invoice-form/payment-rows-field";

describe("store credit application safeguards across invoice, reconciliation, and batch recoveries", () => {
  it("counts customer_credit as confirmed paid immediately with zero pending amount", () => {
    const breakdown = calculatePaymentBreakdown(1500, [
      { ...blankPayment("customer_credit"), amount: 600 },
      { ...blankPayment("cash"), amount: 400, walletId: "w-cash" },
    ]);
    expect(breakdown).toEqual({
      invoiceTotal: 1500,
      paidAmount: 1000,
      pendingAmount: 0,
      outstandingAmount: 500,
      payLaterAmount: 500,
      overAllocatedAmount: 0,
    });
  });

  it("wires customer_credit validation, zero-wallet handling, and cumulative caps across invoice, reconciliation, and batch recovery flows", () => {
    const formSource = readFileSync(resolve(process.cwd(), "src/components/sales/create-invoice-form.tsx"), "utf8");
    const recSource = readFileSync(resolve(process.cwd(), "src/routes/_protected/sales/reconciliation/index.tsx"), "utf8");
    const batchSource = readFileSync(resolve(process.cwd(), "src/components/sales/batch-recoveries-dialog.tsx"), "utf8");

    expect(formSource).toContain("useCustomerCreditSummary");
    expect(formSource).toContain('payment.method !== "expense_offset" && payment.method !== "customer_credit" && !payment.walletId');
    expect(recSource).toContain('"customer_credit"');
    expect(recSource).toContain("Apply Store Credit");
    expect(recSource).toContain("totalCreditApplied");
    expect(recSource).toContain("totalCustomerRefunds");
    expect(batchSource).toContain('"customer_credit"');
    expect(batchSource).toContain("customerCreditBalance");
  });

  it("omits and normalizes blank optional payment references in slip reconciliation", () => {
    const recSource = readFileSync(resolve(process.cwd(), "src/routes/_protected/sales/reconciliation/index.tsx"), "utf8");
    const recFnSource = readFileSync(resolve(process.cwd(), "src/server-functions/sales/reconciliation-fn.ts"), "utf8");

    expect(recSource).toContain("reference: value.reference?.trim() || undefined");
    expect(recFnSource).not.toContain("reference: z.string().trim().min(1).optional()");
    expect(
      recFnSource.match(
        /reference:\s*z\s*\.string\(\)\s*\.trim\(\)\s*\.transform\(\(val\) => \(val\.length > 0 \? val : undefined\)\)\s*\.optional\(\)/g,
      ),
    ).toHaveLength(2);
    expect(
      recFnSource.match(/if \(row\.method === "bank_transfer" && !row\.reference\)/g),
    ).toHaveLength(2);
  });
});
