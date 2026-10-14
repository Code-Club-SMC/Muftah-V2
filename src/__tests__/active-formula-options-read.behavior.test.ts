import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  middleware: vi.fn(),
  viewPermission: {},
}));
vi.mock("@/db", () => ({
  db: { query: { formulas: { findMany: mocks.findMany } } },
}));
vi.mock("@/lib/middlewares", () => ({
  requireManufacturingViewMiddleware: mocks.viewPermission,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: (middlewares: unknown[]) => {
        mocks.middleware(middlewares);
        return builder;
      },
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));

import { getActiveFormulaOptionsFn } from "@/server-functions/manufacturing/formulas/get-active-formula-options-fn";

const rows = Array.from({ length: 102 }, (_, index) => ({
  id: `formula-${index + 1}`,
  name: `Formula ${index + 1}`,
  productId: "product-1",
  batchSize: "123",
  batchUnit: "kg",
  estimatedIngredientsCost: "9876.54",
  isActive: index < 101,
}));

describe("active formula option read", () => {
  beforeEach(() => {
    mocks.findMany.mockReset().mockImplementation(async (options) => {
      const generated = new PgDialect().sqlToQuery(options.where);
      expect(generated.sql).toContain('"formulas"."is_active"');
      expect(generated.params).toEqual([true]);
      const active = rows.filter((row) => row.isActive);
      return active
        .slice(
          options.offset ?? 0,
          options.limit ? (options.offset ?? 0) + options.limit : undefined,
        )
        .map((row) =>
          Object.fromEntries(
            Object.keys(options.columns).map((column) => [
              column,
              row[column as keyof typeof row],
            ]),
          ),
        );
    });
  });

  it("returns every active option beyond 100 with only the dropdown and preview fields", async () => {
    const result = await (
      getActiveFormulaOptionsFn as unknown as () => Promise<
        Record<string, unknown>[]
      >
    )();
    expect(result).toHaveLength(101);
    expect(result[100]).toEqual({
      id: "formula-101",
      name: "Formula 101",
      productId: "product-1",
      batchSize: "123",
      batchUnit: "kg",
      estimatedIngredientsCost: "9876.54",
    });
    const query = mocks.findMany.mock.calls[0][0];
    expect(query.limit).toBeUndefined();
    expect(query.offset).toBeUndefined();
    expect(query.with).toBeUndefined();
    expect(result.some((option) => option.id === "formula-102")).toBe(false);
  });
  it("retains manufacturing view permission middleware", () => {
    expect(mocks.middleware).toHaveBeenCalledWith([mocks.viewPermission]);
  });
});
