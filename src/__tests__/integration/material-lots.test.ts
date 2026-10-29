// src/__tests__/integration/material-lots.test.ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, user, warehouses, chemicals, materialStock, materialLotStock, materialLotMovements } from "@/db";
import { findOrCreateLot, listLotBalances, lockMaterialStock, moveLotStock, relocateAllLots, takeLotPicks, type Tx } from "@/lib/inventory/material-lots.server";

const rollback = new Error("Rollback material lot fixture");
const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Lot actor", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [other] = await tx.insert(warehouses).values({ ...warehouseValues, name: `${id}-b` }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  return { actor, floor, other, ref: { materialType: "chemical" as const, materialId: soda.id } };
}

async function inFixture(check: (tx: Tx, fixture: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Use isolated TEST_DATABASE_URL");
  try { await db.transaction(async (tx) => { await check(tx, await seed(tx)); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}

async function total(tx: Tx, warehouseId: string, chemicalId: string) {
  const [row] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, warehouseId), eq(materialStock.chemicalId, chemicalId)));
  return row?.quantity;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("material lot stock", () => {
  it("joins the same price, splits a new price, and keeps the item total in step", () => inFixture(async (tx, { floor, ref }) => {
    await lockMaterialStock(tx, [floor.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    const again = await findOrCreateLot(tx, ref, "115.00");
    const b = await findOrCreateLot(tx, ref, "125");
    expect(again.id).toBe(a.id);
    expect(b.id).not.toBe(a.id);
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "300", sourceType: "purchase", sourceId: "p1" });
    await moveLotStock(tx, { ref, lotId: b.id, warehouseId: floor.id, delta: "500", sourceType: "purchase", sourceId: "p2" });
    expect(await total(tx, floor.id, ref.materialId)).toBe("800.000");
    expect((await listLotBalances(tx, floor.id, ref)).map((row) => [row.unitPrice, row.quantity])).toEqual([["115.00", "300.000"], ["125.00", "500.000"]]);
  }));

  it("takes exactly the picked lots and refuses overdrawing", () => inFixture(async (tx, { floor, ref }) => {
    await lockMaterialStock(tx, [floor.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    const b = await findOrCreateLot(tx, ref, "125");
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "120", sourceType: "purchase" });
    await moveLotStock(tx, { ref, lotId: b.id, warehouseId: floor.id, delta: "80", sourceType: "purchase" });
    const picked = await takeLotPicks(tx, { warehouseId: floor.id, ref, name: "Soda", unit: "kg", required: "200", sourceType: "mixing", sourceId: "run", picks: [{ lotId: a.id, quantity: "120" }, { lotId: b.id, quantity: "80" }] });
    expect(picked.map((row) => row.totalCost)).toEqual(["13800.00", "10000.00"]);
    expect(await total(tx, floor.id, ref.materialId)).toBe("0.000");
    await expect(takeLotPicks(tx, { warehouseId: floor.id, ref, name: "Soda", unit: "kg", required: "1", sourceType: "mixing", picks: [{ lotId: a.id, quantity: "1" }] }))
      .rejects.toThrow("Soda: one picked lot has no stock here");
  }));

  it("turns stock from before lots into an opening lot at the item price", () => inFixture(async (tx, { floor, ref }) => {
    await tx.insert(materialStock).values({ warehouseId: floor.id, chemicalId: ref.materialId, quantity: "40" });
    await lockMaterialStock(tx, [floor.id], [ref]);
    const balances = await listLotBalances(tx, floor.id, ref);
    expect(balances.map((row) => [row.unitPrice, row.quantity])).toEqual([["115.00", "40.000"]]);
    const movements = await tx.select().from(materialLotMovements).where(eq(materialLotMovements.lotId, balances[0].lotId));
    expect(movements.map((row) => row.sourceType)).toEqual(["opening"]);
    expect(await total(tx, floor.id, ref.materialId)).toBe("40.000");
  }));

  it("relocates every lot when a store closes", () => inFixture(async (tx, { floor, other, ref }) => {
    await lockMaterialStock(tx, [floor.id, other.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "10", sourceType: "purchase" });
    await relocateAllLots(tx, { fromWarehouseId: floor.id, toWarehouseId: other.id, ref, sourceId: floor.id });
    expect(await total(tx, floor.id, ref.materialId)).toBe("0.000");
    expect(await total(tx, other.id, ref.materialId)).toBe("10.000");
    const [moved] = await tx.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, a.id), eq(materialLotStock.warehouseId, other.id)));
    expect(moved.quantity).toBe("10.000");
  }));
});
