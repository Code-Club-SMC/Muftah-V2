import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("invoice settlement reporting", () => {
  it("reports public invoice numbers and current settlement totals", () => {
    const source = read("src/server-functions/reports/sales-report-fn.ts");

    expect(source).toContain("invoiceNumber: invoices.invoiceNumber");
    expect(source).toContain("paidAmount: invoices.paidAmount");
    expect(source).toContain("outstandingAmount: invoices.outstandingAmount");
    expect(source).not.toContain("invoices.cash");
    expect(source).not.toContain("invoices.credit");
  });

  it("separates confirmed collections, pending instruments, and exceptions", () => {
    const source = read(
      "src/server-functions/reports/collections-report-fn.ts",
    );

    expect(source).toContain('eq(payments.status, "confirmed")');
    expect(source).toContain("payments.effectiveDate");
    expect(source).toContain('eq(payments.status, "pending")');
    expect(source).toContain("payments.paymentDate");
    expect(source).toContain('inArray(payments.status, ["returned", "cancelled", "reversed"])');
  });

  it("uses stored invoice settlement totals without subtracting twice", () => {
    const source = read(
      "src/server-functions/reports/outstanding-report-fn.ts",
    );

    expect(source).toContain("invoiceAmount: slipRecords.invoiceAmount");
    expect(source).toContain("paidAmount: slipRecords.paidAmount");
    expect(source).toContain("outstandingAmount: slipRecords.outstandingAmount");
    expect(source).not.toContain("totalDue - totalRecovered");
    expect(source).not.toContain("amountDue - amountRecovered");
  });

  it("uses plain settlement wording on the report screens", () => {
    const source = [
      "src/routes/_protected/reports/index.tsx",
      "src/routes/_protected/reports/sales/index.tsx",
      "src/routes/_protected/reports/outstanding/index.tsx",
      "src/routes/_protected/reports/collections/index.tsx",
    ]
      .map(read)
      .join("\n");

    for (const oldLabel of [
      "Cash Received",
      "Total Credit",
      "Credit Outstanding",
      "Credit Closed",
      "Credit Return Date",
      "Credits Report",
      "Bounced",
    ]) {
      expect(source).not.toContain(oldLabel);
    }
  });
});
