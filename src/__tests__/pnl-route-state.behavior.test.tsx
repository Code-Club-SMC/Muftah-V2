import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  navigate: vi.fn(),
  search: { from: "2026-10-01", to: "2026-10-31", source: "all" },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({
    options,
    useSearch: () => state.search,
  }),
  useNavigate: () => state.navigate,
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock("@/server-functions/reports/profit-loss/company-pnl-fn", () => ({
  getCompanyProfitLossFn: (input: any) => state.fetch(input),
}));
vi.mock("@/server-functions/reports/profit-loss/export-csv-fn", () => ({
  exportPnlCsvFn: vi.fn(),
}));
vi.mock("@/components/reports/offline-report-pending-banner", () => ({
  OfflineReportPendingBanner: () => (
    <p>Offline invoices waiting to be posted</p>
  ),
}));
vi.mock("@/components/custom/date-range-picker", () => ({
  DatePickerWithRange: ({ onDateChange }: any) => (
    <button
      onClick={() =>
        onDateChange({ from: new Date(2026, 9, 2), to: new Date(2026, 9, 3) })
      }
    >
      Change date draft
    </button>
  ),
}));
vi.mock("@/components/reports/profit-loss/pnl-charts", () => ({
  MarginTrendChart: () => null,
  PnlTrendChart: () => null,
  ProfitabilityChart: () => null,
  RevenueCostSnapshotChart: () => null,
  TopGrossProfitBar: () => null,
}));
import { Route } from "@/routes/_protected/reports/profit-loss/index";
afterEach(cleanup);
const fixture = {
  generatedAt: "2026-10-13T19:00:00Z",
  comparisonLabel: "Previous period",
  reportPeriod: { label: "October 2026" },
  status: {
    key: "no_activity",
    label: "No activity",
    description: "No activity",
  },
  summary: {
    totalRevenue: 0,
    totalCogs: 0,
    grossProfit: 0,
    grossMargin: 0,
    invoiceExpenses: 0,
    payroll: 0,
    commissions: 0,
    tada: 0,
    generalExpenses: 0,
    totalOperatingExpenses: 0,
    netProfit: 0,
    netMargin: 0,
    totalUnits: 0,
    invoiceCount: 0,
  },
  deltas: {},
  monthlyTrend: [],
  perProduct: [],
  perRecipe: [],
  deductionBreakdown: [],
  reconciliation: {
    currentAccountBalance: 0,
    balanceAsOfEnd: 0,
    periodNetMovement: 0,
    bridgeRows: [],
  },
};
it("company route refetches identical filters, blocks draft exports, and offers Retry after failed refresh", async () => {
  state.fetch.mockResolvedValue(fixture);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as any;
  const view = render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply Range" }));
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Change date draft"));
  expect(
    screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Invoice source: All invoices")).toBeTruthy();
  expect(screen.getByText(/Reporting period:/).textContent).toContain(
    "01 Oct 2026 to 31 Oct 2026",
  );
  // Remount clears picker draft while retaining the successful applied query.
  view.unmount();
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  state.fetch.mockRejectedValueOnce(new Error("Refresh offline"));
  fireEvent.click(screen.getByRole("button", { name: "Apply Range" }));
  await waitFor(() => expect(screen.getByText("Refresh offline")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  client.clear();
});
