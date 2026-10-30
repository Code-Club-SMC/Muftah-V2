import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, products, warehouses, chemicals, materialStock } from "@/db";
import { materialLotMovements, materialLotStock } from "@/db/schemas/inventory-schema";
import { formulas, mixingRuns, mixingMaterialsUsed } from "@/db/schemas/production-schema";
import { findOrCreateLot, type Tx } from "@/lib/inventory/material-lots.server";
import { recoverFailedProductionChemicalFn } from "@/server-functions/inventory/stock/recover-failed-production-chemical-fn";
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
vi.mock("@/lib/middlewares", () => ({ requireFailedBatchRecoveryMiddleware: {} }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

// A failed batch that took 120 kg from lot A (Rs 115) and 80 kg from lot B (Rs 125). Both lots are empty on the floor.
async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Mixer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "200", batchUnit: "kg" }).returning();
  const [chemical] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const ref = { materialType: "chemical" as const, materialId: chemical.id };
  const lotA = await findOrCreateLot(tx, ref, "115");
  const lotB = await findOrCreateLot(tx, ref, "125");
  const [run] = await tx.insert(mixingRuns).values({
    batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
    targetBulkQuantity: "200", bulkUnit: "kg", status: "failed",
  }).returning();
  await tx.insert(mixingMaterialsUsed).values([
    { mixingRunId: run.id, chemicalId: chemical.id, lotId: lotA.id, quantityUsed: "120", costPerUnit: "115", totalCost: "13800" },
    { mixingRunId: run.id, chemicalId: chemical.id, lotId: lotB.id, quantityUsed: "80", costPerUnit: "125", totalCost: "10000" },
  ]);
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: [] } };
  const recover = (extra: Record<string, unknown>) =>
    recoverFailedProductionChemicalFn({ data: { batchId: run.batchId, chemicalId: chemical.id, reason: "Recovered from tank", ...extra }, context } as never);
  const onFloor = async (lotId: string) => {
    const [row] = await tx.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, lotId), eq(materialLotStock.warehouseId, floor.id)));
    return row?.quantity ?? "0.000";
  };
  return { floor, chemical, run, lotA, lotB, recover, onFloor };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("failed batch recovery with lots", () => {
  it("refills the lots in the order the batch took them", () => withRollback(async (tx) => {
    const { floor, chemical, run, lotA, lotB, recover, onFloor } = await seed(tx);
    await recover({ recoveredQuantity: 150 });
    expect(await onFloor(lotA.id)).toBe("120.000");
    expect(await onFloor(lotB.id)).toBe("30.000");
    const [total] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, chemical.id)));
    expect(total.quantity).toBe("150.000");
    const movements = await tx.select().from(materialLotMovements).where(eq(materialLotMovements.warehouseId, floor.id));
    expect(movements).toHaveLength(2);
    expect(movements.every((row) => row.sourceType === "recovery" && row.sourceId === run.id)).toBe(true);
  }));

  it("uses the lot split the operator chose", () => withRollback(async (tx) => {
    const { lotA, lotB, recover, onFloor } = await seed(tx);
    await recover({ recoveredQuantity: 150, lotReturns: [{ lotId: lotB.id, quantity: "80" }, { lotId: lotA.id, quantity: "70" }] });
    expect(await onFloor(lotA.id)).toBe("70.000");
    expect(await onFloor(lotB.id)).toBe("80.000");
  }));

  it("refuses to give a lot back more than the batch took from it", () => withRollback(async (tx) => {
    const { lotA, lotB, recover, onFloor } = await seed(tx);
    await expect(recover({ recoveredQuantity: 150, lotReturns: [{ lotId: lotB.id, quantity: "90" }, { lotId: lotA.id, quantity: "60" }] }))
      .rejects.toThrow("Lot returns can't be more than this batch took from that lot");
    await expect(recover({ recoveredQuantity: 150, lotReturns: [{ lotId: lotA.id, quantity: "100" }] }))
      .rejects.toThrow("Lot returns must add up to the recovered quantity");
    expect(await onFloor(lotB.id)).toBe("0.000");
  }));
});
