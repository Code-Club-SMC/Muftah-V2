import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRecipeSchema, updateRecipeSchema } from "@/lib/validators/validators";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  methods: [] as unknown[],
  middleware: vi.fn(),
  managePermission: {},
}));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/middlewares", () => ({ requireManufacturingManageMiddleware: mocks.managePermission }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: (options: unknown) => {
    mocks.methods.push(options);
    let schema: { parse: (data: unknown) => unknown };
    const builder = {
      middleware: (middlewares: unknown[]) => { mocks.middleware(middlewares); return builder; },
      inputValidator: (validator: typeof schema) => { schema = validator; return builder; },
      handler: (handler: (input: { data: unknown }) => unknown) =>
        async ({ data }: { data: unknown }) => handler({ data: schema.parse(data) }),
    };
    return builder;
  },
}));

import { createRecipeFn } from "@/server-functions/inventory/recipes/create-recipe-fn";
import { updateRecipeFn } from "@/server-functions/inventory/recipes/update-recipe-fn";

const valid = {
  id: "format-1",
  productId: "product-1", formulaId: "formula-1", name: "  Small pouch  ",
  batchSize: "100", batchUnit: "kg", fillAmount: "250", fillUnit: "g",
  containerType: "pack", containerPackagingId: "pouch", containersPerCarton: 20,
  cartonPackagingId: "carton", minimumStockLevel: 0,
  additionalPackaging: [{ packagingMaterialId: "label", quantityPerContainer: 1, usageBasis: "per_unit" }],
};

describe.each([createRecipeSchema, updateRecipeSchema])("packaging format input", (schema) => {
  it("trims the name and accepts explicit cartons or loose packs", () => {
    expect(schema.parse(valid).name).toBe("Small pouch");
    expect(schema.safeParse({ ...valid, containersPerCarton: 0, cartonPackagingId: "_none" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, fillAmount: "0.251", fillUnit: "kg" }).success).toBe(true);
  });

  it.each(["", " ", "0", "-1", "1abc", "1e2", "NaN", "Infinity", ".5", "1.0001", "10000000", "0.1", "250.001"])("rejects malformed or unrepresentable gram fill %s", (fillAmount) => {
    expect(schema.safeParse({ ...valid, fillAmount }).success).toBe(false);
  });

  it.each([
    { name: "   " }, { name: "x".repeat(101) },
    { fillUnit: "ml" }, { batchUnit: "liters" },
    { containersPerCarton: 0 }, { cartonPackagingId: "" }, { cartonPackagingId: "_none" },
    { cartonPackagingId: "pouch" }, { containerPackagingId: "_none" },
    { containersPerCarton: 1.5 }, { containersPerCarton: 2_147_483_648 },
    { minimumStockLevel: 2_147_483_648 }, { targetUnitsPerBatch: 2_147_483_648 },
  ])("rejects an invalid definition %j", (change) => {
    expect(schema.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it.each([0, -1, Infinity, NaN, 0.0000001, 0.0000000001, 10_000])("rejects unsupported extra quantity %s", (quantityPerContainer) => {
    expect(schema.safeParse({ ...valid, additionalPackaging: [{ ...valid.additionalPackaging[0], quantityPerContainer }] }).success).toBe(false);
  });

  it.each([0.04175, 0.000001, 9999.999999])("preserves supported six-decimal material quantities %s", quantityPerContainer => {
    expect(schema.parse({ ...valid, additionalPackaging: [{ ...valid.additionalPackaging[0], quantityPerContainer }] }).additionalPackaging[0].quantityPerContainer).toBe(quantityPerContainer);
  });

  it("rejects repeated materials, overlaps and per-carton extras on loose formats", () => {
    for (const packagingMaterialId of ["pouch", "carton", "label"]) {
      expect(schema.safeParse({ ...valid, additionalPackaging: [...valid.additionalPackaging, { packagingMaterialId, quantityPerContainer: 1 }] }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, containersPerCarton: 0, cartonPackagingId: undefined, additionalPackaging: [{ ...valid.additionalPackaging[0], usageBasis: "per_carton" }] }).success).toBe(false);
    expect(schema.safeParse({ ...valid, additionalPackaging: [{ ...valid.additionalPackaging[0], usageBasis: "per_carton", quantityPerContainer: 0.125 }] }).success).toBe(true);
  });
});

describe("packaging format server guards", () => {
  beforeEach(() => { mocks.transaction.mockReset(); });

  const invoke = (fn: unknown, data = valid) => (fn as (input: { data: unknown }) => Promise<unknown>)({ data });
  function mockTransaction(batchUnit = "kg", batchSize = "100", allocation?: object, stock?: object) {
    let reads = 0;
    const lock = vi.fn(async () => ++reads === 1
      ? [{ id: "format-1", formulaId: "formula-1", productId: "product-1", batchUnit, batchSize, isActive: true }]
      : [{ id: "formula-1", productId: "product-1", batchUnit, batchSize, isActive: true }]);
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ for: lock }) }) }));
    const tx = { select, query: { packagingAllocations: { findFirst: vi.fn(async () => allocation) }, finishedGoodsStock: { findFirst: vi.fn(async () => stock) } } };
    mocks.transaction.mockImplementation(async (handler) => handler(tx));
    return { tx, lock };
  }

  it("uses POST and manufacturing management permission for both mutations", () => {
    expect(mocks.methods).toEqual([{ method: "POST" }, { method: "POST" }]);
    expect(mocks.middleware).toHaveBeenNthCalledWith(1, [mocks.managePermission]);
    expect(mocks.middleware).toHaveBeenNthCalledWith(2, [mocks.managePermission]);
  });

  it.each([createRecipeFn, updateRecipeFn])("rejects forged input bulk units before writing", async (fn) => {
    const { tx } = mockTransaction("liters");
    await expect(invoke(fn)).rejects.toThrow("must match the mixing bulk unit");
    expect(tx.select).toHaveBeenCalledTimes(fn === createRecipeFn ? 1 : 2);
  });

  it.each([createRecipeFn, updateRecipeFn])("rejects a computed target outside the integer range", async (fn) => {
    mockTransaction("kg", "99999999");
    await expect(invoke(fn, { ...valid, fillAmount: "1" })).rejects.toThrow("supported limit");
  });

  it.each([createRecipeFn, updateRecipeFn])("rejects fills bigger than the stored formula batch", async (fn) => {
    mockTransaction("kg", "0.1");
    await expect(invoke(fn)).rejects.toThrow("exceeds the mixing formula batch size");
  });

  it("retains the row lock and packing history refusal", async () => {
    const { lock } = mockTransaction("kg", "100", { id: "job-1" });
    await expect(invoke(updateRecipeFn)).rejects.toThrow("packing jobs");
    expect(lock).toHaveBeenCalledWith("update");
  });

  it("retains finished-stock refusal", async () => {
    mockTransaction("kg", "100", undefined, { quantityOutsidePacks: 1 });
    await expect(invoke(updateRecipeFn)).rejects.toThrow("finished stock");
  });
});
