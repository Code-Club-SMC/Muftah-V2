import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, user, warehouses, chemicals, materialStock, inventoryAuditLog } from "@/db";
import { materialLotMovements, materialLotStock } from "@/db/schemas/inventory-schema";
import { findOrCreateLot, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { adjustStockFn } from "@/server-functions/inventory/stock/adjust-stock-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";

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
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const rollback = new Error("rollback");
const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

// The floor holds lot A: 120 kg at Rs 115. Another chemical has its own lot.
// Everything runs in one transaction that is rolled back, and other floors are switched off inside it
// so the adjustment finds this floor.
async function withFloor(check: (tx: Tx, f: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      const f = await seed(tx);
      const spy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await check(tx, f);
      } finally {
        spy.mockRestore();
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Storekeeper", email: `${id}@test.invalid` }).returning();
  await tx.update(warehouses).set({ isActive: false }).where(eq(warehouses.type, "factory_floor"));
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [chemical] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const [other] = await tx.insert(chemicals).values({ name: `${id}-salt`, unit: "kg", costPerUnit: "40" }).returning();
  const ref = { materialType: "chemical" as const, materialId: chemical.id };
  const lotA = await findOrCreateLot(tx, ref, "115");
  const otherLot = await findOrCreateLot(tx, { materialType: "chemical", materialId: other.id }, "40");
  await moveLotStock(tx, { ref, lotId: lotA.id, warehouseId: floor.id, delta: "120", sourceType: "purchase" });
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: [] } };
  const adjust = (lotId: string, adjustment: number) =>
    adjustStockFn({ data: { materialType: "chemical", materialId: chemical.id, lotId, adjustment, reason: "Count short" }, context } as never);
  const onFloor = async () => {
    const [lot] = await tx.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, lotA.id), eq(materialLotStock.warehouseId, floor.id)));
    const [total] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, chemical.id)));
    return { lot: lot.quantity, total: total.quantity };
  };
  const edit = async (quantity: string, lotId?: string) => {
    const [stock] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, chemical.id)));
    return updateMaterialFn({ data: { id: chemical.id, type: "chemical", data: { name: chemical.name, unit: "kg", costPerUnit: "130", minimumStockLevel: "0" }, stock: { stockId: stock.id, quantity, lotId } }, context } as never);
  };
  return { floor, chemical, lotA, otherLot, adjust, edit, onFloor };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("stock adjustments with lots", () => {
  it("takes from and adds to the picked lot", async () => {
    await withFloor(async (tx, { floor, lotA, adjust, onFloor }) => {
      await expect(adjust(lotA.id, -2)).resolves.toMatchObject({ previousQty: 120, newQty: 118 });
      expect(await onFloor()).toEqual({ lot: "118.000", total: "118.000" });
      await adjust(lotA.id, 5);
      expect(await onFloor()).toEqual({ lot: "123.000", total: "123.000" });
      const movements = await tx.select().from(materialLotMovements)
        .where(and(eq(materialLotMovements.warehouseId, floor.id), ne(materialLotMovements.sourceType, "purchase")));
      expect(movements.map((row) => [row.sourceType, row.delta])).toEqual([["adjustment", "-2.000"], ["adjustment", "5.000"]]);
      const audit = await tx.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.warehouseId, floor.id));
      expect(audit.every((row) => row.lotId === lotA.id)).toBe(true);
    });
  });

  it("refuses to take more than the lot holds", async () => {
    await withFloor(async (_tx, { lotA, adjust, onFloor }) => {
      await expect(adjust(lotA.id, -200)).rejects.toThrow("Not enough stock in this lot");
      expect(await onFloor()).toEqual({ lot: "120.000", total: "120.000" });
    });
  });

  it("refuses a lot of another item", async () => {
    await withFloor(async (_tx, { otherLot, adjust, onFloor }) => {
      await expect(adjust(otherLot.id, 5)).rejects.toThrow("This lot belongs to another item");
      expect(await onFloor()).toEqual({ lot: "120.000", total: "120.000" });
    });
  });

  it("changes stock from the edit form through the picked lot", async () => {
    await withFloor(async (tx, { floor, chemical, lotA, edit, onFloor }) => {
      await expect(edit("118")).rejects.toThrow("Pick the lot this stock change belongs to");
      await edit("118", lotA.id);
      expect(await onFloor()).toEqual({ lot: "118.000", total: "118.000" });
      await edit("118");
      const [saved] = await tx.select().from(chemicals).where(eq(chemicals.id, chemical.id));
      expect(saved.costPerUnit).toBe("130.00");
      const movements = await tx.select().from(materialLotMovements)
        .where(and(eq(materialLotMovements.warehouseId, floor.id), eq(materialLotMovements.sourceType, "adjustment")));
      expect(movements.map((row) => row.delta)).toEqual(["-2.000"]);
      await expect(edit("200", lotA.id)).resolves.toMatchObject({ success: true });
      await expect(edit("0", lotA.id)).resolves.toMatchObject({ success: true });
      expect(await onFloor()).toEqual({ lot: "0.000", total: "0.000" });
    });
  });
});
