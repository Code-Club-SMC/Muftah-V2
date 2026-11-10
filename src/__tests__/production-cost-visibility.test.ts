import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), mixingRun: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));
vi.mock("@/db", () => ({
  db: {
    transaction: mocks.transaction,
    query: { mixingRuns: { findFirst: mocks.mixingRun } },
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireAuthMiddleware: {},
  requireProductionWorkReadMiddleware: {},
}));
vi.mock(
  "@/server-functions/manufacturing/packaging/batch-packing-core.server",
  () => ({
    authorizePacking: vi.fn(),
    packingAvailability: async () => ({ toFixed: () => "10.000" }),
  }),
);

import { getBatchPackingContextFn } from "@/server-functions/manufacturing/packaging/get-batch-packing-context-fn";
import { getMixingRunFn } from "@/server-functions/manufacturing/mixing/get-mixing-run-fn";

// createServerFn is mocked to expose handlers without the HTTP transport.
type Handler = (args: {
  data: Record<string, string>;
  context: {
    session: { user: { id: string } };
    authContext: { permissions: string[] };
  };
}) => Promise<any>;
const packing = getBatchPackingContextFn as unknown as Handler;
const mixing = getMixingRunFn as unknown as Handler;
const context = (permissions: string[]) => ({
  session: { user: { id: "operator-1" } },
  authContext: { permissions },
});

describe("production cost visibility at the server boundary", () => {
  beforeEach(() => {
    const allocation = {
      id: "allocation-1",
      packingReceiptId: "receipt-1",
      status: "completed",
      formatSnapshot: { name: "50g Pack" },
      allocatedChemicalCost: "2880.00",
      totalPackagingCost: "600.00",
      totalProductionCost: "3480.00",
      actualCostPerPack: "6.0417",
      actualPacksProduced: 576,
      actualBulkConsumed: "28.800",
      mixingRun: { totalChemicalCost: "5000.00" },
    };
    const run = {
      id: "batch-1",
      formulaId: "formula-1",
      operatorId: "operator-1",
      status: "completed",
      totalChemicalCost: "5000.00",
      chemicalCostPerUnit: "100.00",
      bulkUnit: "kg",
      formula: {
        name: "Powder",
        ingredients: [],
        estimatedIngredientsCost: "4900.00",
      },
      materialsUsed: [],
      packagingAllocations: [allocation],
    };
    mocks.mixingRun.mockResolvedValue(run);
    const tables: Record<string, unknown[]> = {
      mixing_runs: [run],
      formulas: [{ id: "formula-1", name: "Powder", productId: "product-1" }],
      recipes: [],
      packaging_materials: [],
      batch_packing_receipts: [
        {
          id: "receipt-1",
          totalPacks: 576,
          costAudit: { chemicalCost: "2880.00" },
        },
      ],
      packaging_allocations: [allocation],
    };
    mocks.transaction.mockImplementation(async (fn) =>
      fn({
        select: () => ({
          from: (table: Parameters<typeof getTableName>[0]) => {
            const query = Promise.resolve(
              tables[getTableName(table)] ?? [],
            ) as any;
            query.where = () => query;
            query.for = () => query;
            query.orderBy = () => query;
            return query;
          },
        }),
      }),
    );
  });

  it.each([
    "manufacturing.run.manage",
    "manufacturing.run.read",
    "manufacturing.view",
    "*",
  ])("returns saved batch and receipt costs for %s", async (permission) => {
    const batch = await mixing({
      data: { id: "batch-1" },
      context: context([permission]),
    });
    expect(batch.costSummary).toEqual({
      chemicalCost: "5000.00",
      packagingCost: "600.00",
      totalCost: "5600.00",
    });
    const result = await packing({
      data: { mixingRunId: "batch-1" },
      context: context([permission]),
    });
    expect(result.receipts[0].costs).toEqual({
      chemicalCost: "2880.00",
      packagingCost: "600.00",
      totalCost: "3480.00",
    });
    expect(result.receipts[0].lines[0].costs.costPerPack).toBe("6.0417");
    expect(result.receipts[0]).not.toHaveProperty("costAudit");
  });

  it("omits receipt costs and batch totals from an operator's server response", async () => {
    const actor = context(["operator.run.read", "operator.run.complete"]);
    const batch = await mixing({ data: { id: "batch-1" }, context: actor });
    expect(batch.costSummary).toBeNull();
    expect(batch.totalChemicalCost).toBeNull();
    expect(batch.packagingAllocations[0].totalProductionCost).toBe("0");
    const result = await packing({
      data: { mixingRunId: "batch-1" },
      context: actor,
    });
    expect(result.receipts[0].costs).toBeNull();
    expect(result.receipts[0].lines[0].costs).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/2880|3480|6\.0417|costAudit/);
  });
});
