import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, products, warehouses, chemicals } from "@/db";
import { formulas, formulaIngredients, mixingRuns, mixingMaterialsUsed } from "@/db/schemas/production-schema";
import { findOrCreateLot, lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
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
vi.mock("@/lib/middlewares", () => ({ requireManufacturingRunManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Mixer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "200", batchUnit: "kg" }).returning();
  const [chemical] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  await tx.insert(formulaIngredients).values({ formulaId: formula.id, chemicalId: chemical.id, quantityPerBatch: "200" });
  const ref = { materialType: "chemical" as const, materialId: chemical.id };
  await lockMaterialStock(tx, [floor.id], [ref]);
  const lotA = await findOrCreateLot(tx, ref, "115");
  const lotB = await findOrCreateLot(tx, ref, "125");
  await moveLotStock(tx, { ref, lotId: lotA.id, warehouseId: floor.id, delta: "120", sourceType: "purchase" });
  await moveLotStock(tx, { ref, lotId: lotB.id, warehouseId: floor.id, delta: "80", sourceType: "purchase" });
  const [run] = await tx.insert(mixingRuns).values({
    batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
    targetBulkQuantity: "200", bulkUnit: "kg", status: "scheduled",
  }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  return { context, run, chemical, lotA, lotB };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("mixing start with lots", () => {
  it("costs the batch at the picked lot prices and records one usage row per lot", () => withRollback(async (tx) => {
    const { context, run, chemical, lotA, lotB } = await seed(tx);
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "120" }] }] }, context } as never))
      .rejects.toThrow("lots add up to 120");
    await startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "120" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never);
    const [started] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, run.id));
    expect(started.totalChemicalCost).toBe("23800.00");
    const used = await tx.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, run.id));
    expect(used.map((row) => [row.lotId, row.quantityUsed, row.costPerUnit, row.totalCost]).sort()).toEqual([
      [lotA.id, "120.000", "115.00", "13800.00"], [lotB.id, "80.000", "125.00", "10000.00"],
    ].sort());
  }));

  it("refuses a newer lot while an older one still has stock", () => withRollback(async (tx) => {
    const { context, run, chemical, lotA, lotB } = await seed(tx);
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "100" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never))
      .rejects.toThrow("lots add up to 180");
    await tx.update(formulaIngredients).set({ quantityPerBatch: "100" }).where(eq(formulaIngredients.chemicalId, chemical.id));
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "20" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never))
      .rejects.toThrow("use the oldest stock first. Take 100 kg from Lot");
  }));

  it("refuses a start without picks for every formula chemical", () => withRollback(async (tx) => {
    const { context, run } = await seed(tx);
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [] }, context } as never)).rejects.toThrow("Pick lots for");
  }));
});
