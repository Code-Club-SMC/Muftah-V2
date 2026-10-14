import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  warehouse: vi.fn(),
  batches: vi.fn(),
  select: vi.fn(),
  middleware: vi.fn(),
}));
vi.mock("@/db", async () => ({
  ...(await import("@/db/schemas/inventory-schema")),
  db: {
    query: {
      warehouses: { findFirst: mocks.warehouse },
      mixingRuns: { findMany: mocks.batches },
    },
    select: mocks.select,
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireFactoryFloorViewMiddleware: "factory-floor-view",
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: mocks.middleware.mockImplementation(() => ({
      handler: (fn: unknown) => fn,
    })),
  }),
}));

import { getFactoryFloorStockFn } from "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn";

const batch = {
  id: "run-1",
  batchId: "A0001",
  actualBulkProduced: "80.000",
  bulkUnit: "liters",
  formula: { name: "Mixing Formula" },
  packagingAllocations: [] as {
    status: string;
    allocatedBulkQuantity: string;
  }[],
};
const invoke = () =>
  (getFactoryFloorStockFn as unknown as () => Promise<any>)();

describe("factory-floor mixed bulk", () => {
  beforeEach(() => {
    mocks.warehouse
      .mockReset()
      .mockResolvedValue({ id: "north", finishedGoodsStock: [] });
    mocks.batches.mockReset().mockResolvedValue([batch]);
    const query: any = {
      from: () => query,
      where: () => query,
      groupBy: async () => [],
    };
    mocks.select.mockReset().mockReturnValue(query);
  });

  it("loads positive completed output only from this factory floor behind its existing permission check", async () => {
    const result = await invoke();
    expect(mocks.middleware).toHaveBeenCalledWith(["factory-floor-view"]);
    const where = mocks.batches.mock.calls[0][0].where;
    const generated = new PgDialect().sqlToQuery(where);
    expect(generated.params).toEqual(["north", "completed", "0"]);
    expect(generated.sql).toContain('"mixing_runs"."warehouse_id"');
    expect(result.mixedBulk).toEqual([
      {
        id: "run-1",
        batchId: "A0001",
        formulaName: "Mixing Formula",
        bulkUnit: "liters",
        producedQuantity: "80",
        reservedQuantity: "0",
        availableQuantity: "80",
      },
    ]);
  });

  it("excludes cancelled reservations and uses exact decimal arithmetic across active and completed jobs", async () => {
    mocks.batches.mockResolvedValue([
      {
        ...batch,
        actualBulkProduced: "0.300",
        bulkUnit: "kg",
        packagingAllocations: [
          { status: "allocated", allocatedBulkQuantity: "0.100" },
          { status: "in_progress", allocatedBulkQuantity: "0.050" },
          { status: "completed", allocatedBulkQuantity: "0.050" },
          { status: "cancelled", allocatedBulkQuantity: "0.200" },
        ],
      },
    ]);
    expect((await invoke()).mixedBulk[0]).toMatchObject({
      producedQuantity: "0.3",
      reservedQuantity: "0.2",
      availableQuantity: "0.1",
      bulkUnit: "kg",
    });
  });

  it("keeps fully reserved bulk awaiting packing and removes batches committed entirely to completed jobs", async () => {
    mocks.batches.mockResolvedValue([
      {
        ...batch,
        packagingAllocations: [
          { status: "allocated", allocatedBulkQuantity: "80" },
        ],
      },
      {
        ...batch,
        id: "packed",
        packagingAllocations: [
          { status: "completed", allocatedBulkQuantity: "80" },
        ],
      },
    ]);
    expect((await invoke()).mixedBulk).toEqual([
      expect.objectContaining({
        id: "run-1",
        reservedQuantity: "80",
        availableQuantity: "0",
      }),
    ]);
  });

  it("skips batch reads when no active factory floor exists", async () => {
    mocks.warehouse.mockResolvedValue(undefined);
    expect(await invoke()).toBeNull();
    expect(mocks.batches).not.toHaveBeenCalled();
  });
});
