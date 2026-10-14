import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: ["inventory.view"] as string[],
  floor: vi.fn(),
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));
vi.mock(
  "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn",
  () => ({ getFactoryFloorStockFn: mocks.floor }),
);
vi.mock("@/server-functions/inventory/get-warehouses-fn", () => ({
  getWarehousesFn: async () => [],
}));
vi.mock(
  "@/server-functions/inventory/factory-floor/get-consumption-history-fn",
  () => ({
    getConsumptionHistoryFn: async () => ({ data: [], totalCount: 0 }),
  }),
);
vi.mock("@/components/inventory/add-warehouse-dialog", () => ({
  AddWarehouseDialog: () => null,
}));
vi.mock("@/components/inventory/stock-table", () => ({
  StockTable: () => null,
}));
vi.mock("@/components/inventory/finished-goods-table", () => ({
  FinishedGoodsTable: () => null,
}));
vi.mock("@/components/inventory/low-stocks-alert", () => ({
  LowStockAlerts: () => null,
}));
vi.mock("@/components/inventory/consumption-table", () => ({
  ConsumptionTable: () => null,
}));
vi.mock("@/components/inventory/adjust-stock-dialog", () => ({
  AdjustStockDialog: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, ...props }: any) => (
    <a href={to.replace("$runId", params.runId)} {...props}>
      {children}
    </a>
  ),
}));
import { MixedBulkTable } from "@/components/inventory/mixed-bulk-table";
import { FactoryFloorContainer } from "@/components/inventory/factory-floor-container";

const batch = {
  id: "run-1",
  batchId: "A0001",
  formulaName: "Dishwash",
  bulkUnit: "liters",
  producedQuantity: "80",
  reservedQuantity: "20",
  availableQuantity: "60",
};

describe("mixed bulk display", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.permissions = ["inventory.view"];
    mocks.floor.mockReset().mockResolvedValue({
      id: "north",
      name: "North Warehouse",
      isActive: true,
      materialStock: [],
      finishedGoodsStock: [],
      mixedBulk: [batch],
    });
  });
  it("shows each quantity with its unit and opens the matching mixing batch", () => {
    render(<MixedBulkTable data={[batch]} canOpenBatch />);
    const row = screen.getByText("A0001").closest("tr")!;
    for (const value of ["Dishwash", "80 liters", "20 liters", "60 liters"]) {
      expect(within(row).getByText(value)).toBeTruthy();
    }
    expect(
      screen
        .getByRole("link", { name: "Open Batch A0001" })
        .getAttribute("href"),
    ).toBe("/manufacturing/mixing/run-1");
  });
  it("keeps quantities visible without a batch navigation action for inventory-only readers", () => {
    render(<MixedBulkTable data={[batch]} canOpenBatch={false} />);
    expect(screen.getByText("60 liters")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  });
  it("explains the empty state", () => {
    render(<MixedBulkTable data={[]} canOpenBatch />);
    expect(screen.getByText("No Mixed Bulk Awaiting Packing")).toBeTruthy();
  });

  it.each([
    { permissions: ["inventory.view"], canOpen: false },
    {
      permissions: ["inventory.view", "manufacturing.run.read"],
      canOpen: true,
    },
  ])(
    "opens the tab and respects batch route access for $permissions",
    async ({ permissions, canOpen }) => {
      mocks.permissions = permissions;
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <Suspense fallback="Loading">
            <FactoryFloorContainer />
          </Suspense>
        </QueryClientProvider>,
      );
      const tab = await screen.findByRole("tab", { name: "Mixed Bulk" });
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
      await screen.findByRole("table", { name: "Mixed bulk awaiting packing" });
      expect(screen.getByText("60 liters")).toBeTruthy();
      expect(!!screen.queryByRole("link", { name: "Open Batch A0001" })).toBe(
        canOpen,
      );
      client.clear();
    },
  );
});
