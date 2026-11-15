import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: ["inventory.view", "inventory.manage"] as string[],
  floor: vi.fn(),
  stockTableProps: [] as any[],
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
  StockTable: (props: any) => {
    mocks.stockTableProps.push(props);
    return <div data-testid={`stock-table-${props.type}`}>{props.data.map((d: any) => d.chemical?.name || d.packagingMaterial?.name).join(", ")}</div>;
  },
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
vi.mock("@/components/inventory/mixed-bulk-table", () => ({
  MixedBulkTable: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: any) => <a>{children}</a>,
}));

import { FactoryFloorContainer } from "@/components/inventory/factory-floor-container";

describe("factory floor stock exclusion of deleted/zero stock", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.stockTableProps = [];
    mocks.floor.mockReset().mockResolvedValue({
      id: "floor-1",
      name: "Factory Floor",
      isActive: true,
      materialStock: [
        // Active chemical
        {
          id: "stock-1",
          warehouseId: "floor-1",
          chemicalId: "chem-1",
          packagingMaterialId: null,
          quantity: "50.000",
          chemical: { id: "chem-1", name: "Soda Ash", unit: "kg" },
          packagingMaterial: null,
        },
        // Deleted chemical with 0 stock (e.g. from deleting purchase from supplier)
        {
          id: "stock-2",
          warehouseId: "floor-1",
          chemicalId: "chem-2",
          packagingMaterialId: null,
          quantity: "0.000",
          chemical: { id: "chem-2", name: "test", unit: "kg" },
          packagingMaterial: null,
        },
        // Active packaging
        {
          id: "stock-3",
          warehouseId: "floor-1",
          chemicalId: null,
          packagingMaterialId: "pkg-1",
          quantity: "100.000",
          chemical: null,
          packagingMaterial: { id: "pkg-1", name: "500ml Bottle", type: "primary" },
        },
        // Deleted packaging with 0 stock
        {
          id: "stock-4",
          warehouseId: "floor-1",
          chemicalId: null,
          packagingMaterialId: "pkg-2",
          quantity: "0.000",
          chemical: null,
          packagingMaterial: { id: "pkg-2", name: "Empty Box", type: "primary" },
        },
      ],
      finishedGoodsStock: [],
      mixedBulk: [],
    });
  });

  it("filters out zero-quantity stocks so deleted purchases do not show on factory floor", async () => {
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

    const chemicalsTable = await screen.findByTestId("stock-table-chemical");
    expect(chemicalsTable.textContent).toContain("Soda Ash");
    expect(chemicalsTable.textContent).not.toContain("test");

    // Check KPI cards: Chemicals should count 1, Packaging should count 1 (ignoring 0-quantity rows)
    const kpiElements = screen.getAllByText("1");
    expect(kpiElements.length).toBeGreaterThan(0);

    client.clear();
  });
});
