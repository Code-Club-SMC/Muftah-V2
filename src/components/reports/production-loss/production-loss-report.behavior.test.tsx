import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: ["reports.loss.view"] as string[],
  view: vi.fn(),
  print: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("@/server-functions/reports/production-loss-fn", () => ({
  getProductionLossFn: mocks.view, getProductionLossPrintFn: mocks.print, updateLossLimitsFn: mocks.update,
}));
import { ProductionLossReport } from "./production-loss-report";

const limits = { batch: "10.0", chemical: "10.0", powder: "10.0", shopper: "10.0", otherPacking: "10.0" };
const row = { tab: "batch", id: "r1", date: "2026-10-12T06:00:00.000Z", batchId: "A0104", productId: "p", product: "Surf Powder", formulaId: "f", formula: "F", unit: "kg", target: "500", actual: "400", loss: "100.000", percent: "20.0", cost: "30115.00", reasonCode: "spill", reasonName: "Spill", reason: "Spill", over: true, link: { kind: "run", runId: "r1" } };
const result = {
  strip: { batch: "30115.00", chemical: "575.00", powder: "0.00", packing: "0.00", store: "0.00", total: "30690.00" },
  limits, limitsUpdatedAt: null, limitsUpdatedBy: null,
  options: [{ key: "reason", label: "Reason", options: [{ value: "spill", label: "Spill" }] }],
  summary: [{ label: "Loss cost", value: "Rs 30,115" }], totals: ["Total", "", "", "500 KG", "400 KG", "100 KG", "20.0%", "30,115", ""],
  columns: [], rows: [row], total: 1, page: 1, pageCount: 1,
};

function renderReport(onOpenRow = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProductionLossReport onOpenRow={onOpenRow} /></QueryClientProvider>);
  return onOpenRow;
}
const lastInput = () => mocks.view.mock.calls.at(-1)![0].data;

describe("production loss page", () => {
  beforeEach(() => {
    mocks.permissions = ["reports.loss.view"];
    // The batch row only fits batch columns, so other tabs come back empty.
    mocks.view.mockReset().mockImplementation(({ data }: { data: { tab: string } }) =>
      Promise.resolve(data.tab === "batch" ? result : { ...result, rows: [], totals: [], total: 0 }));
  });
  afterEach(cleanup);

  it("shows the strip, opens a tab from it and keeps the date range", async () => {
    renderReport();
    await screen.findByText("Rs 30,690");
    const first = lastInput();
    expect(first.tab).toBe("batch");
    fireEvent.click(screen.getByRole("button", { name: /Chemical\s*Rs 575/ }));
    await waitFor(() => expect(lastInput().tab).toBe("chemical"));
    expect([lastInput().dateFrom, lastInput().dateTo]).toEqual([first.dateFrom, first.dateTo]);
  });

  it("asks for only over-limit rows when switched on", async () => {
    renderReport();
    await screen.findByText("A0104");
    fireEvent.click(screen.getByRole("switch", { name: "Only over limit" }));
    await waitFor(() => expect(lastInput().onlyOverLimit).toBe(true));
  });

  it("marks over-limit rows and opens the batch on click", async () => {
    const onOpenRow = renderReport();
    const cell = await screen.findByText("A0104");
    expect(cell.closest("tr")?.getAttribute("data-over")).toBe("true");
    fireEvent.click(cell);
    expect(onOpenRow).toHaveBeenCalledWith({ kind: "run", runId: "r1" });
  });

  it("hides loss limits without the manage permission", async () => {
    renderReport();
    await screen.findByText("A0104");
    expect(screen.queryByRole("button", { name: "Loss limits" })).toBeNull();
    cleanup();
    mocks.permissions = ["reports.loss.view", "reports.loss.limits.manage"];
    renderReport();
    expect(await screen.findByRole("button", { name: "Loss limits" })).toBeTruthy();
  });
});
