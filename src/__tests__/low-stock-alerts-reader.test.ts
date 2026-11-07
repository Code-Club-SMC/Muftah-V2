import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLowStockAlertsFn } from "@/server-functions/inventory/stock/get-low-stocks-alert-fn";
import { finishedAvailableUnits } from "@/lib/inventory/finished-stock-availability.server";

const mocks = vi.hoisted(() => ({
  floor: vi.fn(),
  queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db = drizzle(async (sql, params) => {
    mocks.queries.push({ sql, params });
    if (sql.includes('"usable_carton_packs"'))
      return {
        rows: [
          ["recipe", "17"],
          ["loose", "9"],
          ["empty", "0"],
        ],
      };
    if (sql.includes('from "chemicals"'))
      return {
        rows: [
          ["c", "Soda", "5.000", "5.00", "kg"],
          ["missing", "Absent material", "0", "0", "liters"],
          ["healthy", "Salt", "6", "5", "kg"],
        ],
      };
    if (sql.includes('from "packaging_materials"'))
      return { rows: [["kg", "Shopper", "0", "0", "kg"]] };
    if (sql.includes('from "recipes"'))
      return {
        rows: [
          ["recipe", "Bottled", 20],
          ["loose", "Loose only", 8],
          ["empty", "Empty recipe", 0],
        ],
      };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return {
    db: {
      select: db.select.bind(db),
      query: { warehouses: { findFirst: mocks.floor } },
    },
  };
});
vi.mock("@/lib/middlewares", () => ({ requireFactoryFloorViewMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, handler: (fn: unknown) => fn };
    return b;
  },
}));
const invoke = () => (getLowStockAlertsFn as unknown as () => Promise<any[]>)();
beforeEach(() => {
  mocks.queries.length = 0;
  mocks.floor.mockReset().mockResolvedValue({ id: "floor", name: "Floor" });
});
describe("stock alerts authoritative reads", () => {
  it("uses floor-scoped catalog left joins, zero stock, shared status, stable identities and severity ordering", async () => {
    const rows = await invoke();
    expect(rows.map((r) => r.id)).toEqual([
      "floor:raw:missing",
      "floor:finished:empty",
      "floor:packaging:kg",
      "floor:finished:recipe",
      "floor:raw:c",
    ]);
    expect(rows.find((r) => r.materialId === "recipe")).toMatchObject({
      currentStock: "17",
      minLevel: "20",
      status: "low",
    });
    expect(rows.find((r) => r.materialId === "kg")).toMatchObject({
      currentStock: "0",
      unit: "kg",
      status: "out",
    });
    expect(mocks.queries).toHaveLength(4);
    for (const table of ["chemicals", "packaging_materials"]) {
      const query = mocks.queries.find((q) =>
        q.sql.includes(`from "${table}"`),
      )!;
      expect(query.sql).toContain('left join "material_stock"');
      expect(query.sql).toContain('"material_stock"."warehouse_id" =');
      expect(query.sql).not.toContain('"material_lots"');
      expect(query.params).toContain("floor");
    }
    const selection = mocks.floor.mock.calls[0][0];
    expect(new PgDialect().sqlToQuery(selection.where).params).toEqual([
      "factory_floor",
      true,
    ]);
    expect(
      selection.orderBy.map(
        (order: never) => new PgDialect().sqlToQuery(order).sql,
      ),
    ).toEqual(['"warehouses"."created_at" asc', '"warehouses"."id" asc']);
  });
  it("availability sums actual usable carton packs and outside packs, with a loose-only fallback", async () => {
    expect(await finishedAvailableUnits("floor")).toEqual(
      new Map([
        ["recipe", 17],
        ["loose", 9],
        ["empty", 0],
      ]),
    );
    const query = mocks.queries[0];
    expect(query.sql).toContain('sum("current_packs")');
    expect(query.sql).toContain('"quantity_outside_packs"');
    expect(query.sql).toContain('"quantity_containers"');
    expect(query.sql).not.toContain('"quantity_cartons"');
    expect(query.params).toEqual(
      expect.arrayContaining(["COMPLETE", "SEALED", "PARTIAL", "floor", true]),
    );
    expect(query.params).not.toContain("ON_HOLD");
  });
  it("does no stock reads when no active factory floor exists", async () => {
    mocks.floor.mockResolvedValue(undefined);
    expect(await invoke()).toEqual([]);
    expect(mocks.queries).toHaveLength(0);
  });
});
