import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

const sales = read("src/server-functions/reports/sales-report-fn.ts");
const outstanding = read(
  "src/server-functions/reports/outstanding-report-fn.ts",
);
const collections = read(
  "src/server-functions/reports/collections-report-fn.ts",
);
const company = read(
  "src/server-functions/reports/profit-loss/company-reporting-core.ts",
);
const exportCsv = read(
  "src/server-functions/reports/profit-loss/export-csv-fn.ts",
);
const performance = read(
  "src/server-functions/hr/payroll/sales-performance-fn.ts",
);
const banner = read("src/components/reports/offline-report-pending-banner.tsx");
const history = read("src/components/sales/offline/import-history.tsx");

describe("offline sales reporting boundaries", () => {
  it("places sales and outstanding amounts on invoice business time", () => {
    expect(sales).toContain("gte(invoices.date, from)");
    expect(sales).toContain("lte(invoices.date, endOfDay(to))");
    expect(outstanding).toContain("gte(invoices.date, from)");
    expect(outstanding).toContain("lte(invoices.date, endOfDay(to))");
    expect(sales).not.toContain("gte(invoices.createdAt");
    expect(outstanding).not.toContain("gte(invoices.createdAt");
  });

  it("places confirmed collections on effective date and pending instruments on receipt date", () => {
    expect(collections).toContain(
      "dateConditions(payments.effectiveDate, data.dateFrom, data.dateTo)",
    );
    expect(collections).toContain(
      "dateConditions(payments.paymentDate, data.dateFrom, data.dateTo)",
    );
    expect(collections).toContain('eq(payments.status, "confirmed")');
    expect(collections).toContain('eq(payments.status, "pending")');
  });

  it("filters each report by the final invoice source without unioning duplicates", () => {
    for (const source of [
      sales,
      outstanding,
      collections,
      company,
      exportCsv,
    ]) {
      expect(source).toContain("invoices.source");
      expect(source).toMatch(/source (?:!==|===) "all"/);
      expect(source.toLowerCase()).not.toContain("union all");
    }
  });

  it("uses saved invoice-item cost and the invoice date for profit", () => {
    expect(company).toContain("invoiceDate: invoices.date");
    expect(company).toContain("cogs: invoiceItems.costOfGoodsSold");
    expect(company).toContain(
      "cogsPerUnit: invoiceItems.costOfGoodsSoldPerUnit",
    );
  });

  it("uses earned business dates for sales performance", () => {
    expect(performance).toContain(
      "gte(commissionRecords.earnedAt, monthStart)",
    );
    expect(performance).toContain("gte(invoices.date, monthStart)");
    expect(performance).not.toContain(
      "gte(commissionRecords.calculatedAt, monthStart)",
    );
    expect(performance).not.toContain("gte(invoices.createdAt, monthStart)");
  });

  it("warns while normalized offline rows are not terminal", () => {
    expect(banner).toContain("Offline invoices are waiting to be posted");
    expect(banner).toContain("Current reports may be");
    expect(banner).toContain("incomplete.");
  });

  it("keeps audit time separate from outage business time", () => {
    expect(history).toContain("batch.uploadedAt");
    expect(history).toContain("batch.outageStartedAt");
    expect(history).toContain("batch.outageEndedAt");
  });
});
