import React from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ report: {} as any }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({
    options,
    useSearch: () => ({ from: "2026-10-01", to: "2026-10-31", source: "all" }),
    useParams: () => ({ productId: "product", recipeId: "recipe" }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, params: _params, search: _search, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/server-functions/reports/profit-loss/company-pnl-fn", () => ({
  getCompanyProfitLossFn: async () => state.report,
}));
vi.mock(
  "@/server-functions/reports/profit-loss/product-pnl-for-reports-fn",
  () => ({ getProductProfitLossForReportsFn: async () => state.report }),
);
vi.mock("@/server-functions/reports/profit-loss/recipe-pnl-fn", () => ({
  getRecipeProfitLossFn: async () => state.report,
}));
vi.mock("@/server-functions/reports/profit-loss/export-csv-fn", () => ({
  exportPnlCsvFn: vi.fn(),
}));
vi.mock("@/server-functions/reports/offline-report-status-fn", () => ({
  getOfflineReportStatusFn: async () => ({ hasUnpostedOfflineInvoices: true }),
}));

import { Route as Company } from "@/routes/_protected/reports/profit-loss/index";
import { Route as Product } from "@/routes/_protected/reports/profit-loss/product/$productId/index";
import { Route as Recipe } from "@/routes/_protected/reports/profit-loss/recipe/$recipeId/index";

function fixture(count: number) {
  const summary = {
    totalRevenue: count * 1234.56,
    totalCogs: count * 1000.25,
    grossProfit: count * 234.31,
    grossMargin: 18.98,
    grossMarginPercent: 18.98,
    invoiceExpenses: 0,
    payroll: 0,
    commissions: 0,
    tada: 0,
    generalExpenses: 0,
    totalOperatingExpenses: 0,
    netProfit: count * 234.31,
    netMargin: 18.98,
    netMarginPercent: 18.98,
    totalUnits: count * 10,
    soldUnits: count * 10,
    invoiceCount: count,
    failedBatchLosses: 0,
    netImpact: count * 234.31,
    netImpactMarginPercent: 18.98,
    averageSellingPricePerUnit: 123.456,
    cogsPerUnit: 100.025,
    grossProfitPerUnit: 23.431,
    netProfitPerUnit: 23.431,
    netImpactPerUnit: 23.431,
  };
  const records = Array.from({ length: count }, (_, i) => ({
    id: `ROW-${String(i + 1).padStart(3, "0")}`,
    name:
      i % 3 === 0
        ? "Industrial detergent for commercial manufacturing and distribution"
        : "Detergent",
  }));
  const invoices = records.map(({ id, name }) => ({
    invoiceId: id,
    invoiceNumber: id,
    invoiceDate: "2026-10-13T10:00:00Z",
    customerName: `${id} Customer with a long trading name Pakistan Limited`,
    recipeId: id,
    recipeName: name,
    variantLabel: "500 ml",
    pack: "24-pack carton",
    realizedUnits: 10,
    realizedCartons: 1,
    realizedRevenue: 1234.56,
    realizedCogs: 1000.25,
    realizedProfit: 234.31,
    realizedRatio: 0.5,
    invoiceStatus: "partially_paid",
  }));
  return {
    generatedAt: "2026-10-14T03:30:00Z",
    source: "all",
    comparisonLabel: "vs Sep 2026",
    reportPeriod: {
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      label: "01 Oct 2026 - 31 Oct 2026",
    },
    status: {
      key: count ? "profit" : "no_activity",
      label: count ? "Profit" : "No activity",
      description: count
        ? "Positive operational result for this selection."
        : "No activity in this period.",
    },
    summary,
    previousSummary: summary,
    deltas: {},
    kpis: {},
    product: {
      id: "product",
      name: "Industrial detergent",
      description: "Print verification fixture",
      category: "Cleaning products",
      imageUrl: null,
      productCode: "DET-01",
    },
    recipe: {
      id: "recipe",
      name: "500 ml detergent",
      recipeCode: "DET-500",
      variantLabel: "500 ml",
      product: {
        id: "product",
        name: "Industrial detergent",
        productCode: "DET-01",
      },
    },
    monthlyTrend: count
      ? [{ monthKey: "2026-10-01", monthLabel: "Oct 2026", ...summary }]
      : [],
    perProduct: records.map(({ id, name }) => ({
      productId: id,
      productName: `${id} ${name}`,
      productCategory: "Cleaning products",
      revenue: 1234.56,
      cogs: 1000.25,
      profit: 234.31,
      margin: 18.98,
      invoiceCount: 1,
      units: 10,
    })),
    perRecipe: records.map(({ id, name }) => ({
      recipeId: id,
      recipeName: `${id} ${name}`,
      profit: 234.31,
    })),
    recipes: records.map(({ id, name }) => ({
      ...summary,
      totalRevenue: 1234.56,
      grossProfit: 234.31,
      netProfit: 234.31,
      netImpact: 234.31,
      recipeId: id,
      recipeName: `${id} ${name}`,
      variantLabel: "500 ml",
      name,
    })),
    recentInvoices: invoices.slice(0, 12),
    invoiceDetails: invoices,
    failedBatchLosses: [],
    currentInventoryWacPerPack: 100.025,
    deductionBreakdown: count
      ? [
          {
            type: "general",
            label: "General expenses",
            description: "Fixture includes no operating expenses",
            amount: 0,
          },
        ]
      : [],
    reconciliation: {
      currentAccountBalance: 0,
      balanceAsOfEnd: 0,
      periodNetMovement: 0,
      salesInflows: 0,
      expenseOutflows: 0,
      payrollOutflows: 0,
      bridgeRows: [],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
for (const [kind, route] of Object.entries({
  company: Company,
  product: Product,
  recipe: Recipe,
})) {
  for (const count of [0, 3, 100]) {
    it(`renders ${kind} P&L with ${count} records for print`, async () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      state.report = fixture(count);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const Component = route.options.component as React.ComponentType;
      const { container, unmount } = render(
        <QueryClientProvider client={client}>
          <Component />
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: /^print$/i })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      expect(container.querySelector("[data-report-document]")).toBeTruthy();
      expect(container.textContent).toContain("Invoice source: All invoices");
      for (let i = 1; i <= count; i++)
        expect(container.textContent).toContain(
          `ROW-${String(i).padStart(3, "0")}`,
        );
      expect(container.textContent).not.toContain("NaN");
      const output = process.env.REPORT_FIXTURE_DIR;
      if (output) {
        mkdirSync(output, { recursive: true });
        writeFileSync(
          join(output, `pnl-${kind}-${count}.html`),
          `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>${kind} profitability fixture</title><link rel="stylesheet" href="report-app.css"></head><body>${container.innerHTML}</body></html>`,
        );
      }
      unmount();
      client.clear();
    });
  }
}
