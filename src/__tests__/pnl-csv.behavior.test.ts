import { it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware() {
      return this;
    },
    inputValidator() {
      return this;
    },
    handler(fn: any) {
      return fn;
    },
  }),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/middlewares", () => ({ requireReportsViewMiddleware: {} }));
vi.mock(
  "@/server-functions/reports/profit-loss/company-reporting-core",
  () => ({ getCompanyReportData: () => state.report() }),
);
vi.mock("@/server-functions/reports/profit-loss/reporting-core", () => ({
  fetchScopedInvoiceRows: vi.fn(),
}));
import { exportPnlCsvFn } from "@/server-functions/reports/profit-loss/export-csv-fn";
it("company reconciliation escapes grouped amounts and formula-leading quoted descriptions once", async () => {
  state.report.mockResolvedValue({
    reportPeriod: { label: "October" },
    source: "all",
    status: { label: "Profit" },
    summary: {
      totalRevenue: 0,
      totalCogs: 0,
      grossProfit: 0,
      invoiceExpenses: 0,
      payroll: 0,
      commissions: 0,
      tada: 0,
      generalExpenses: 0,
      totalOperatingExpenses: 0,
      netProfit: 0,
    },
    realizedLines: [],
    reconciliation: {
      periodNetMovement: 1234.56,
      bridgeRows: [
        {
          label: '=HYPERLINK("x")',
          amount: 1234.56,
          direction: "positive",
          description: '@note "quoted", with comma',
        },
        {
          label: "Correction",
          amount: -10.25,
          direction: "negative",
          description: "Adjustment",
        },
      ],
    },
  });
  const result = await (exportPnlCsvFn as any)({
    data: { dateFrom: "2026-10-01", dateTo: "2026-10-31", source: "all" },
  });
  expect(result.csv).toContain(
    '"\'=HYPERLINK(""x"")","1,234.56",positive,"\'@note ""quoted"", with comma"',
  );
  expect(result.csv).toContain("Correction,-10.25,negative,Adjustment");
  expect(result.csv).not.toContain('"""1,234.56"""');
});
