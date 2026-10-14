import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock("@/server-functions/reports/sales-report-fn", () => ({
  getSalesReportFn: (input: any) => state.fetch(input),
}));
vi.mock("@/components/reports/offline-report-pending-banner", () => ({
  OfflineReportPendingBanner: () => null,
}));
vi.mock("@/components/reports/report-source-select", () => ({
  ReportSourceSelect: ({ onValueChange }: any) => (
    <button onClick={() => onValueChange("online")}>Online draft</button>
  ),
}));
import { Route } from "@/routes/_protected/reports/sales/index";
afterEach(cleanup);
it("same-filter generation refetches and source drafts wait for generation; failed refresh cannot print", async () => {
  state.fetch.mockResolvedValue({
    invoices: [],
    summary: { count: 0, paidAmount: 0, outstandingAmount: 0, totalRevenue: 0 },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as any;
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  const generate = screen.getByRole("button", { name: "Generate Report" });
  fireEvent.click(generate);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(state.fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(generate);
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Online draft"));
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Invoice source: All invoices")).toBeTruthy();
  fireEvent.click(generate);
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.getByText("Invoice source: Online invoices")).toBeTruthy(),
  );
  state.fetch.mockRejectedValueOnce(new Error("Offline"));
  fireEvent.click(generate);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Offline"),
  );
  expect(screen.queryByText("No records for this selection.")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Print" }).hasAttribute("disabled"),
  ).toBe(true);
  client.clear();
});
