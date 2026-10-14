import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ recipe: vi.fn(), transfers: vi.fn(), select: vi.fn() }));
vi.mock("@/db", async () => ({ ...await import("@/db/schemas/inventory-schema"), db: {
  query: { recipes: { findFirst: mocks.recipe }, stockTransfers: { findMany: mocks.transfers } }, select: mocks.select,
} }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryViewMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: any;
  const builder = { middleware: () => builder, inputValidator: (schema: any) => { validator = schema; return builder; },
    handler: (fn: any) => (args: any) => fn({ ...args, data: validator.parse(args.data) }) };
  return builder;
} }));
import { getItemDetailPaginatedFn } from "@/server-functions/inventory/stock/get-item-detail-paginated-fn";

describe("finished stock detail valuation", () => {
  it("weights warehouse WAC by actual remaining units and ignores empty warehouses", async () => {
    mocks.recipe.mockResolvedValue({ id: "recipe", name: "Pack", product: { name: "Product" }, cartonPackagingId: "master", containersPerCarton: 4,
      finishedGoods: [
        { warehouseId: "a", warehouse: { name: "A" }, quantityCartons: 1, quantityContainers: 0, weightedAverageCostPerPack: "13", totalInventoryValue: "52" },
        { warehouseId: "b", warehouse: { name: "B" }, quantityCartons: 0, quantityContainers: 2, weightedAverageCostPerPack: "20", totalInventoryValue: "40" },
        { warehouseId: "empty", warehouse: { name: "Empty" }, quantityCartons: 0, quantityContainers: 0, weightedAverageCostPerPack: "100", totalInventoryValue: "0" },
      ] });
    mocks.transfers.mockResolvedValue([]);
    const query: any = { from: () => query, where: () => query, then: (resolve: any, reject: any) => Promise.resolve([{ value: 0 }]).then(resolve, reject) };
    mocks.select.mockReturnValue(query);
    const result = await (getItemDetailPaginatedFn as any)({ data: { itemType: "finished", itemId: "recipe" } });
    expect(result.item.totalInventoryValue).toBe(92);
    expect(result.item.weightedAverageCostPerPack).toBeCloseTo(92 / 6);
    expect(result.item.weightedAverageCostPerCarton).toBeCloseTo(92 / 6 * 4);
  });
});
