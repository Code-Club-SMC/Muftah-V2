import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, warehouses, chemicals, materialLotStock, stockTransfers } from "@/db";
import { findOrCreateLot, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";
import { withRollback } from "./with-rollback";

// Only the session transport is replaced. Validation, handlers, locks and SQL are real.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown };
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: typeof validator) => {
        validator = schema;
        return builder;
      },
      handler:
        (handler: (input: unknown) => unknown) =>
        (input: { data: unknown; context: unknown }) =>
          handler({ ...input, data: validator.parse(input.data) }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireInventoryManageMiddleware: {},
  requireManufacturingRunManageMiddleware: {},
  requireAuthMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

describe.skipIf(!process.env.TEST_DATABASE_URL)("lot transfers", () => {
  it("moves the picked lots and records one transfer row per lot", () => withRollback(async (tx) => {
    const id = randomUUID();
    const [actor] = await tx.insert(user).values({ id, name: "Store", email: `${id}@test.invalid` }).returning();
    const [from] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
    const [to] = await tx.insert(warehouses).values({ ...warehouseValues, name: `${id}-to` }).returning();
    const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
    const ref = { materialType: "chemical" as const, materialId: soda.id };
    await lockMaterialStock(tx, [from.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    const b = await findOrCreateLot(tx, ref, "125");
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: from.id, delta: "100", sourceType: "purchase" });
    await moveLotStock(tx, { ref, lotId: b.id, warehouseId: from.id, delta: "420", sourceType: "purchase" });
    const context = { session: { user: actor }, authContext: { session: { user: actor } } };
    const base = { fromWarehouseId: from.id, toWarehouseId: to.id, materialType: "chemical", materialId: soda.id, quantity: "150", looseUnits: "0", notes: "" };
    await expect(transferStockFn({ data: base, context } as never)).rejects.toThrow("Pick the lots to move");
    await expect(transferStockFn({ data: { ...base, lotPicks: [{ lotId: a.id, quantity: "100" }] }, context } as never)).rejects.toThrow("lots add up to 100");
    await transferStockFn({ data: { ...base, lotPicks: [{ lotId: a.id, quantity: "100" }, { lotId: b.id, quantity: "50" }] }, context } as never);
    const arrived = await tx.select().from(materialLotStock).where(eq(materialLotStock.warehouseId, to.id));
    expect(arrived.map((row) => row.quantity).sort()).toEqual(["100.000", "50.000"]);
    const rows = await tx.select().from(stockTransfers).where(and(eq(stockTransfers.fromWarehouseId, from.id), eq(stockTransfers.materialId, soda.id)));
    expect(rows.map((row) => [row.lotId, row.quantity]).sort()).toEqual([[a.id, "100.000"], [b.id, "50.000"]].sort());
  }));
});
