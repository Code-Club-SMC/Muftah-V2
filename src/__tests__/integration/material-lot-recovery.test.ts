import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, user, products, warehouses, chemicals, materialStock } from "@/db";
import { materialLotMovements, materialLotStock } from "@/db/schemas/inventory-schema";
import { formulas, mixingRuns, mixingMaterialsUsed } from "@/db/schemas/production-schema";
import { findOrCreateLot } from "@/lib/inventory/material-lots.server";
import { recoverFailedProductionChemicalFn } from "@/server-functions/inventory/stock/recover-failed-production-chemical-fn";

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
vi.mock("@/lib/middlewares", () => ({ requireFailedBatchRecoveryMiddleware: {} }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

// A failed batch that took 120 kg from lot A (Rs 115) and 80 kg from lot B (Rs 125). Both lots are empty on the floor.
async function seed() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Mixer", email: `${id}@test.invalid` }).returning();
  const [floor] = await db.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await db.insert(products).values({ name: id }).returning();
  const [formula] = await db.insert(formulas).values({ productId: product.id, name: id, batchSize: "200", batchUnit: "kg" }).returning();
  const [chemical] = await db.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const ref = { materialType: "chemical" as const, materialId: chemical.id };
  const [lotA, lotB] = await db.transaction(async (tx) => [await findOrCreateLot(tx, ref, "115"), await findOrCreateLot(tx, ref, "125")]);
  const [run] = await db.insert(mixingRuns).values({
    batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
    targetBulkQuantity: "200", bulkUnit: "kg", status: "failed",
  }).returning();
  await db.insert(mixingMaterialsUsed).values([
    { mixingRunId: run.id, chemicalId: chemical.id, lotId: lotA.id, quantityUsed: "120", costPerUnit: "115", totalCost: "13800" },
    { mixingRunId: run.id, chemicalId: chemical.id, lotId: lotB.id, quantityUsed: "80", costPerUnit: "125", totalCost: "10000" },
  ]);
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: [] } };
  const recover = (extra: Record<string, unknown>) =>
    recoverFailedProductionChemicalFn({ data: { batchId: run.batchId, chemicalId: chemical.id, reason: "Recovered from tank", ...extra }, context } as never);
  const onFloor = async (lotId: string) => {
    const [row] = await db.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, lotId), eq(materialLotStock.warehouseId, floor.id)));
    return row?.quantity ?? "0.000";
  };
  return { floor, chemical, run, lotA, lotB, recover, onFloor };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("failed batch recovery with lots", () => {
  it("refills the lots in the order the batch took them", async () => {
    const { floor, chemical, run, lotA, lotB, recover, onFloor } = await seed();
    await recover({ recoveredQuantity: 150 });
    expect(await onFloor(lotA.id)).toBe("120.000");
    expect(await onFloor(lotB.id)).toBe("30.000");
    const [total] = await db.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, chemical.id)));
    expect(total.quantity).toBe("150.000");
    const movements = await db.select().from(materialLotMovements).where(eq(materialLotMovements.warehouseId, floor.id));
    expect(movements).toHaveLength(2);
    expect(movements.every((row) => row.sourceType === "recovery" && row.sourceId === run.id)).toBe(true);
  });

  it("uses the lot split the operator chose", async () => {
    const { lotA, lotB, recover, onFloor } = await seed();
    await recover({ recoveredQuantity: 150, lotReturns: [{ lotId: lotB.id, quantity: "80" }, { lotId: lotA.id, quantity: "70" }] });
    expect(await onFloor(lotA.id)).toBe("70.000");
    expect(await onFloor(lotB.id)).toBe("80.000");
  });

  it("refuses to give a lot back more than the batch took from it", async () => {
    const { lotA, lotB, recover, onFloor } = await seed();
    await expect(recover({ recoveredQuantity: 150, lotReturns: [{ lotId: lotB.id, quantity: "90" }, { lotId: lotA.id, quantity: "60" }] }))
      .rejects.toThrow("Lot returns can't be more than this batch took from that lot");
    await expect(recover({ recoveredQuantity: 150, lotReturns: [{ lotId: lotA.id, quantity: "100" }] }))
      .rejects.toThrow("Lot returns must add up to the recovered quantity");
    expect(await onFloor(lotB.id)).toBe("0.000");
  });
});
