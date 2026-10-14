import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ warehouses: vi.fn(), floor: vi.fn(), stock: vi.fn(), select: vi.fn() }));
vi.mock("@/db", async () => ({
  ...await import("@/db/schemas/inventory-schema"),
  db: { query: { warehouses: { findMany: mocks.warehouses, findFirst: mocks.floor }, finishedGoodsStock: { findMany: mocks.stock }, mixingRuns: { findMany: vi.fn(async () => []) } }, select: mocks.select },
}));
vi.mock("@/lib/middlewares", () => ({ requireInventoryViewMiddleware: {}, requireFactoryFloorViewMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { middleware: () => builder, handler: (fn: () => unknown) => fn };
  return builder;
} }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn(), Link: ({ children }: any) => <a>{children}</a> }));
vi.mock("@/components/inventory/adjust-outside-packs-dialog", () => ({ AdjustOutsidePacksDialog: () => null }));
vi.mock("@/components/inventory/transfer-stock-dialog", () => ({ TransferStockDialog: () => null }));
vi.mock("@/components/custom/data-table", () => ({ DataTable: ({ columns, data }: any) => <div>{data.map((item: any) => <div key={item.id}>{columns.map((column: any) => column.cell && <div key={column.id ?? column.accessorKey} data-testid={column.id ?? column.accessorKey}>{column.cell({ row: { original: item, getValue: (key: string) => item[key] } })}</div>)}</div>)}</div> }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/server-functions/inventory/stock/get-transfer-history-fn", () => ({ getTransferHistoryFn: vi.fn() }));
vi.mock("@/components/inventory/lab-reports/lab-reports-list", () => ({ LabReportsList: () => null }));

import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { getFactoryFloorStockFn } from "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn";
import { getLowStockAlertsFn } from "@/server-functions/inventory/stock/get-low-stocks-alert-fn";
import { FinishedGoodsTable } from "@/components/inventory/finished-goods-table";
import { InventoryDetailsDialog } from "@/components/inventory/inventory-details-dialog";

const stats = { warehouseId: "floor", recipeId: "recipe", total: 2, complete: 1, partial: 1, totalPacks: 6 };
const stock = {
  id: "stock", warehouseId: "floor", recipeId: "recipe", quantityCartons: 1, quantityContainers: 2,
  cartonStats: stats, weightedAverageCostPerPack: "13", weightedAverageCostPerCarton: "52", totalInventoryValue: "78",
  createdAt: new Date(), updatedAt: new Date(), warehouse: { id: "floor", name: "Floor", isActive: true },
  recipe: { id: "recipe", name: "Pack", cartonPackagingId: "master", containersPerCarton: 4, minimumStockLevel: 7,
    estimatedCostPerContainer: "1", batchUnit: "kg", createdAt: new Date(), updatedAt: new Date(), product: { id: "product", name: "Product" } },
};
const floor = { id: "floor", name: "Floor", materialStock: [], finishedGoodsStock: [stock] };
function query(result: unknown[]) {
  const builder: any = { from: () => builder, innerJoin: () => builder, where: () => builder, groupBy: () => builder,
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
  return builder;
}

describe("finished inventory pack totals", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.warehouses.mockReset().mockResolvedValue([floor]);
    mocks.floor.mockReset().mockResolvedValue(floor);
    mocks.stock.mockReset().mockResolvedValue([stock]);
    mocks.select.mockReset().mockImplementation(() => query([stats]));
  });
  it("keeps canonical full and loose quantities in the warehouse inventory read", async () => {
    const result = await getInventoryFn();
    expect(result[0].finishedGoodsStock[0]).toMatchObject({ quantityCartons: 1, quantityContainers: 2, cartonStats: { total: 2, totalPacks: 6 } });
  });
  it("keeps canonical quantities in the factory inventory read", async () => {
    const result = await getFactoryFloorStockFn();
    expect(result?.finishedGoodsStock[0]).toMatchObject({ quantityCartons: 1, quantityContainers: 2, cartonStats: { total: 2, totalPacks: 6 } });
  });
  it.each([getFactoryFloorStockFn, getLowStockAlertsFn])("reads the active factory floor after warehouse relocation", async read => {
    await read();
    expect(new PgDialect().sqlToQuery(mocks.floor.mock.calls[0][0].where).params).toEqual(["factory_floor", true]);
  });
  it("counts partial contents once in total units and low-stock status", () => {
    render(<FinishedGoodsTable data={[stock]} warehouses={[] as any} preselectedWarehouse={undefined} />);
    expect(within(screen.getByTestId("totalUnits")).getAllByText("6").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("status")).getByText("Low Stock")).toBeTruthy();
  });
  it("shows loose-only stock without requiring carton rows", () => {
    render(<FinishedGoodsTable data={[{ ...stock, quantityCartons: 0, quantityContainers: 6, cartonStats: { total: 0, complete: 0, partial: 0, totalPacks: 0 }, recipe: { ...stock.recipe, cartonPackagingId: null } }]} warehouses={[] as any} preselectedWarehouse={undefined} />);
    expect(within(screen.getByTestId("totalUnits")).getAllByText("6").length).toBeGreaterThan(0);
  });
  it("shows actual outside packs even when their total exceeds a carton capacity", () => {
    render(<FinishedGoodsTable data={[{ ...stock, quantityCartons: 2, quantityContainers: 2, quantityOutsidePacks: 10,
      cartonStats: { total: 0, complete: 0, partial: 0, totalPacks: 10 } }]} warehouses={[] as any} preselectedWarehouse={undefined} />);
    const units = within(screen.getByTestId("totalUnits"));
    expect(units.getAllByText("10")).toHaveLength(2);
    expect(units.getByText("Loose")).toBeTruthy();
    expect(within(screen.getByTestId("cartons")).getAllByText("0")).toHaveLength(3);
  });
  it("does not label partial-carton contents as outside packs", () => {
    render(<FinishedGoodsTable data={[{ ...stock, quantityOutsidePacks: 0 }]} warehouses={[] as any} preselectedWarehouse={undefined} />);
    const units = within(screen.getByTestId("totalUnits"));
    expect(units.getByText("Partial")).toBeTruthy();
    expect(units.queryByText("Loose")).toBeNull();
  });
  it("shows all no-carton stock as loose when legacy tracking is zero", () => {
    render(<FinishedGoodsTable data={[{ ...stock, quantityCartons: 0, quantityContainers: 100, quantityOutsidePacks: 0,
      recipe: { ...stock.recipe, cartonPackagingId: null, containersPerCarton: 0 }, cartonStats: { total: 0, complete: 0, partial: 0, totalPacks: 0 } }]} warehouses={[] as any} preselectedWarehouse={undefined} />);
    expect(within(screen.getByTestId("totalUnits")).getAllByText("100")).toHaveLength(2);
  });
  it("shows actual pack quantity and stock WAC in details", () => {
    render(<InventoryDetailsDialog open onOpenChange={() => {}} type="finished" item={stock} />);
    const current = screen.getByText("Current Stock").parentElement!;
    expect(within(current).getByText("6")).toBeTruthy();
    expect(within(current).getByText("Packs")).toBeTruthy();
    expect(screen.getByText("13.00")).toBeTruthy();
  });
  it("reports low stock at six packs against a seven-pack threshold", async () => {
    mocks.select.mockImplementationOnce(() => query([])).mockImplementationOnce(() => query([]));
    const alerts = await getLowStockAlertsFn();
    expect(alerts).toEqual([expect.objectContaining({ materialId: "recipe", currentStock: "6", minLevel: "7" })]);
  });
});
