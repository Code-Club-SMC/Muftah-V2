import { describe, expect, it, vi } from "vitest";
import { getMaterialsFn } from "@/server-functions/inventory/get-materials-fn";
import { getPackagingFormatOptionsFn } from "@/server-functions/inventory/recipes/get-packaging-format-options-fn";

const mockChemicals = [
  { id: "c1", name: "Active Soda", unit: "kg", stock: [{ quantity: "150.000" }] },
  { id: "c2", name: "Deleted Chemical", unit: "kg", stock: [] },
  { id: "c3", name: "Zero Stock Chemical", unit: "kg", stock: [{ quantity: "0.000" }] },
];

const mockPackagings = [
  { id: "p1", name: "Active Bottle", type: "primary", stock: [{ quantity: "500.000" }] },
  { id: "p2", name: "Deleted Packaging", type: "primary", stock: [] },
  { id: "p3", name: "Zero Stock Box", type: "master", stock: [{ quantity: "0.000" }] },
];

const mockProducts = [
  { id: "prod-1", name: "Product A" },
];

vi.mock("@/db", () => ({
  db: {
    query: {
      chemicals: {
        findMany: vi.fn(async () => mockChemicals),
      },
      packagingMaterials: {
        findMany: vi.fn(async () => mockPackagings),
      },
      products: {
        findMany: vi.fn(async () => mockProducts),
      },
    },
  },
}));

vi.mock("@/lib/middlewares", () => ({
  requireInventoryViewMiddleware: {},
  requireManufacturingViewMiddleware: {},
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: any;
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: any) => {
        validator = schema;
        return builder;
      },
      handler: (fn: (input: any) => any) => async (input: any = {}) => {
        const validated = validator ? validator.parse(input?.data) : input?.data;
        return fn({ data: validated });
      },
    };
    return builder;
  },
}));

describe("Materials filtering for deleted/zero stock", () => {
  it("getMaterialsFn returns only items with stock > 0 by default", async () => {
    const result = await getMaterialsFn();
    expect(result.chemicals.map((c) => c.name)).toEqual(["Active Soda"]);
    expect(result.packagings.map((p) => p.name)).toEqual(["Active Bottle"]);
  });

  it("getMaterialsFn returns all items when includeEmpty: true", async () => {
    const result = await (getMaterialsFn as any)({ data: { includeEmpty: true } });
    expect(result.chemicals.length).toBe(3);
    expect(result.packagings.length).toBe(3);
  });

  it("getPackagingFormatOptionsFn returns only packaging with stock > 0", async () => {
    const result = await getPackagingFormatOptionsFn();
    expect(result.packagings).toEqual([
      { id: "p1", name: "Active Bottle", type: "primary" },
    ]);
  });
});
