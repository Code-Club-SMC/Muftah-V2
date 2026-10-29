import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, user, products, warehouses, chemicals } from "@/db";
import { formulas, formulaIngredients, mixingRuns, mixingMaterialsUsed } from "@/db/schemas/production-schema";
import { findOrCreateLot, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";

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

async function seed() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Mixer", email: `${id}@test.invalid` }).returning();
  const [floor] = await db.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await db.insert(products).values({ name: id }).returning();
  const [formula] = await db.insert(formulas).values({ productId: product.id, name: id, batchSize: "200", batchUnit: "kg" }).returning();
  const [chemical] = await db.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  await db.insert(formulaIngredients).values({ formulaId: formula.id, chemicalId: chemical.id, quantityPerBatch: "200" });
  const ref = { materialType: "chemical" as const, materialId: chemical.id };
  const [lotA, lotB] = await db.transaction(async (tx) => {
    await lockMaterialStock(tx, [floor.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    const b = await findOrCreateLot(tx, ref, "125");
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "120", sourceType: "purchase" });
    await moveLotStock(tx, { ref, lotId: b.id, warehouseId: floor.id, delta: "80", sourceType: "purchase" });
    return [a, b];
  });
  const [run] = await db.insert(mixingRuns).values({
    batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
    targetBulkQuantity: "200", bulkUnit: "kg", status: "scheduled",
  }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  return { context, run, chemical, lotA, lotB };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("mixing start with lots", () => {
  it("costs the batch at the picked lot prices and records one usage row per lot", async () => {
    const { context, run, chemical, lotA, lotB } = await seed();
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "120" }] }] }, context } as never))
      .rejects.toThrow("lots add up to 120");
    await startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "120" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never);
    const [started] = await db.select().from(mixingRuns).where(eq(mixingRuns.id, run.id));
    expect(started.totalChemicalCost).toBe("23800.00");
    const used = await db.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, run.id));
    expect(used.map((row) => [row.lotId, row.quantityUsed, row.costPerUnit, row.totalCost]).sort()).toEqual([
      [lotA.id, "120.000", "115.00", "13800.00"], [lotB.id, "80.000", "125.00", "10000.00"],
    ].sort());
  });

  it("refuses a start without picks for every formula chemical", async () => {
    const { context, run } = await seed();
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [] }, context } as never)).rejects.toThrow("Pick lots for");
  });
});
