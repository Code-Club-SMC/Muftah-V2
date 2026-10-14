import { render, screen, within, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ data: {} as any }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: state.data,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({
    options,
    useSearch: () => ({ from: "2026-10-01", to: "2026-10-31", source: "all" }),
    useParams: () => ({ productId: "p", recipeId: "r" }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock(
  "@/server-functions/reports/profit-loss/product-pnl-for-reports-fn",
  () => ({ getProductProfitLossForReportsFn: vi.fn() }),
);
vi.mock("@/server-functions/reports/profit-loss/recipe-pnl-fn", () => ({
  getRecipeProfitLossFn: vi.fn(),
}));
vi.mock("@/server-functions/reports/profit-loss/export-csv-fn", () => ({
  exportPnlCsvFn: vi.fn(),
}));
vi.mock("@/components/reports/offline-report-pending-banner", () => ({
  OfflineReportPendingBanner: () => null,
}));
vi.mock("@/components/reports/profit-loss/pnl-charts", () => ({
  MarginTrendChart: () => null,
  PnlTrendChart: () => null,
  ProfitabilityChart: () => null,
  RevenueCostSnapshotChart: () => null,
  TopGrossProfitBar: () => null,
}));
import { Route as ProductRoute } from "@/routes/_protected/reports/profit-loss/product/$productId/index";
import { Route as RecipeRoute } from "@/routes/_protected/reports/profit-loss/recipe/$recipeId/index";
afterEach(cleanup);
function fixture() {
  return {
    generatedAt: "2026-10-13T19:00:00Z",
    reportPeriod: { label: "October" },
    comparisonLabel: "Previous",
    status: { key: "profit", label: "Profit", description: "Operational" },
    summary: new Proxy({}, { get: () => 0 }),
    kpis: new Proxy({}, { get: () => 0 }),
    monthlyTrend: [],
    product: { name: "Product A", category: "Category", productCode: "P" },
    recipe: {
      name: "Recipe A",
      recipeCode: "R",
      product: { id: "p", name: "Product A" },
    },
    recipes: [],
    recentInvoices: [],
    invoiceDetails: [
      {
        invoiceId: "i1",
        invoiceDate: "2026-10-13",
        customerName: "Customer",
        pack: "1kg",
        realizedUnits: 1,
        realizedRevenue: 1234.56,
        realizedCogs: 1000.01,
        realizedProfit: 234.55,
        realizedRatio: 1,
        invoiceStatus: "paid",
      },
      {
        invoiceId: "i2",
        invoiceDate: "2026-10-13",
        customerName: "Customer",
        pack: "1kg",
        realizedUnits: 2,
        realizedRevenue: 10.25,
        realizedCogs: 20.5,
        realizedProfit: -10.25,
        realizedRatio: 1,
        invoiceStatus: "paid",
      },
    ],
    failedBatchLosses: [
      {
        settlementId: "s1",
        batchId: "b1",
        settledAt: "2026-10-13",
        recipeName: "Recipe A",
        chemicalName: "Chemical",
        expectedQuantity: 1,
        recoveredQuantity: 0,
        lossQuantity: 1,
        lossAmount: 1234.56,
      },
      {
        settlementId: "s2",
        batchId: "b2",
        settledAt: "2026-10-13",
        recipeName: "Recipe A",
        chemicalName: "Chemical",
        expectedQuantity: 1,
        recoveredQuantity: 0,
        lossQuantity: 1,
        lossAmount: 10.25,
      },
    ],
  };
}
it("recipe complete invoice table totals additive money and complete loss trace totals loss", () => {
  state.data = fixture();
  const Component = RecipeRoute.options.component as any;
  render(<Component />);
  const invoiceTotal = screen
    .getByText("Total invoice contribution")
    .closest("tr")!;
  for (const value of ["1,244.81", "1,020.51", "224.30"])
    expect(within(invoiceTotal).getByText(value)).toBeTruthy();
  expect(
    within(
      screen.getByText("Total failed-batch loss").closest("tr")!,
    ).getByText("1,244.81"),
  ).toBeTruthy();
});
it("product complete failed batch trace totals losses without assigning an overall total to recent invoices", () => {
  state.data = fixture();
  const Component = ProductRoute.options.component as any;
  render(<Component />);
  expect(
    within(
      screen.getByText("Total failed-batch loss").closest("tr")!,
    ).getByText("1,244.81"),
  ).toBeTruthy();
  expect(screen.queryByText("Total invoice contribution")).toBeNull();
});
