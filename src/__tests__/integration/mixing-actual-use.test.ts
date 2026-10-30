import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, products, warehouses, chemicals } from "@/db";
import { formulas, formulaIngredients, mixingRuns, mixingMaterialsUsed, mixingMaterialUse } from "@/db/schemas/production-schema";
import { findOrCreateLot, listLotBalances, lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
import { logMixingProgressFn } from "@/server-functions/manufacturing/mixing/log-mixing-progress-fn";
import { completeMixingRunFn } from "@/server-functions/manufacturing/mixing/complete-mixing-run-fn";
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
  requireManufacturingRunManageMiddleware: {},
  requireProductionWorkCompleteMiddleware: {},
  requireProductionWorkLogMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function seedStarted(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Mixer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "400", batchUnit: "kg" }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const [silicate] = await tx.insert(chemicals).values({ name: `${id}-silicate`, unit: "kg", costPerUnit: "90" }).returning();
  await tx.insert(formulaIngredients).values([
    { formulaId: formula.id, chemicalId: soda.id, quantityPerBatch: "50" },
    { formulaId: formula.id, chemicalId: silicate.id, quantityPerBatch: "20" },
  ]);
  const sodaRef = { materialType: "chemical" as const, materialId: soda.id };
  const silicateRef = { materialType: "chemical" as const, materialId: silicate.id };
  await lockMaterialStock(tx, [floor.id], [sodaRef, silicateRef]);
  const soda115 = await findOrCreateLot(tx, sodaRef, "115");
  const soda125 = await findOrCreateLot(tx, sodaRef, "125");
  const silicate90 = await findOrCreateLot(tx, silicateRef, "90");
  await moveLotStock(tx, { ref: sodaRef, lotId: soda115.id, warehouseId: floor.id, delta: "100", sourceType: "purchase" });
  await moveLotStock(tx, { ref: sodaRef, lotId: soda125.id, warehouseId: floor.id, delta: "100", sourceType: "purchase" });
  await moveLotStock(tx, { ref: silicateRef, lotId: silicate90.id, warehouseId: floor.id, delta: "50", sourceType: "purchase" });
  const [run] = await tx.insert(mixingRuns).values({
    batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
    targetBulkQuantity: "400", bulkUnit: "kg", status: "scheduled",
  }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: ["manufacturing.run.manage"] } };
  await startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [
    { materialId: soda.id, picks: [{ lotId: soda115.id, quantity: "50" }] },
    { materialId: silicate.id, picks: [{ lotId: silicate90.id, quantity: "20" }] },
  ] }, context } as never);
  return { context, run, floor, soda, silicate, soda115, soda125, silicate90 };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("mixing completion with actual use", () => {
  it("takes extra from picked floor lots, returns leftover to the batch's lots and costs the batch at lot prices", () => withRollback(async (tx) => {
    const f = await seedStarted(tx); // started, formula cost 7550
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 400 }, context: f.context } as never);
    const [stillOpen] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, f.run.id));
    expect(stillOpen.status).toBe("in_progress"); // reaching target no longer completes

    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [{ chemicalId: f.soda.id, used: "55", picks: [{ lotId: f.soda115.id, quantity: "5" }] }] }, context: f.context } as never))
      .rejects.toThrow("Pick a reason for extra");

    await completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [
      { chemicalId: f.soda.id, used: "55", picks: [{ lotId: f.soda115.id, quantity: "5" }], reason: "spill" },
      { chemicalId: f.silicate.id, used: "18", picks: [{ lotId: f.silicate90.id, quantity: "2" }] },
    ] }, context: f.context } as never);

    const [done] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, f.run.id));
    expect(done.status).toBe("completed");
    expect(done.totalChemicalCost).toBe("7945.00"); // 7550 + 5×115 − 2×90
    expect(done.chemicalCostPerUnit).toBe("19.8625"); // 7945 ÷ 400
    const use = await tx.select().from(mixingMaterialUse).where(eq(mixingMaterialUse.mixingRunId, f.run.id));
    expect(use.map((row) => [row.chemicalId, row.formulaQuantity, row.usedQuantity, row.extraQuantity, row.extraCost, row.reason]).sort()).toEqual([
      [f.soda.id, "50.000", "55.000", "5.000", "575.00", "spill"],
      [f.silicate.id, "20.000", "18.000", "-2.000", "-180.00", null],
    ].sort());
    const rows = await tx.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, f.run.id));
    expect(rows.filter((row) => row.useType === "returned").map((row) => [row.lotId, row.quantityUsed, row.totalCost])).toEqual([[f.silicate90.id, "-2.000", "-180.00"]]);
    const balances = await listLotBalances(tx, f.floor.id, { materialType: "chemical", materialId: f.silicate.id });
    expect(balances.find((row) => row.lotId === f.silicate90.id)?.quantity).toBe("32.000"); // 50 − 20 + 2
  }));

  it("returns leftover only to lots the batch took", () => withRollback(async (tx) => {
    const f = await seedStarted(tx);
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 400 }, context: f.context } as never);
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [{ chemicalId: f.soda.id, used: "48", picks: [{ lotId: f.soda125.id, quantity: "2" }] }] }, context: f.context } as never))
      .rejects.toThrow("one picked lot has no stock here");
  }));

  it("blocks extra the floor doesn't have", () => withRollback(async (tx) => {
    const f = await seedStarted(tx);
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 400 }, context: f.context } as never);
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [{ chemicalId: f.silicate.id, used: "60", picks: [{ lotId: f.silicate90.id, quantity: "40" }], reason: "leak" }] }, context: f.context } as never))
      .rejects.toThrow("has only 30");
  }));

  it("needs a listed shortfall reason below target and keeps the note", () => withRollback(async (tx) => {
    const f = await seedStarted(tx);
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 380 }, context: f.context } as never);
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id }, context: f.context } as never)).rejects.toThrow("shortfall reason");
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, shortfallReason: "other" }, context: f.context } as never)).rejects.toThrow('Write a note for "Other"');
    await completeMixingRunFn({ data: { mixingRunId: f.run.id, shortfallReason: "moisture_loss", shortfallNote: "humid day" }, context: f.context } as never);
    const [done] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, f.run.id));
    expect([done.shortfallReasonCode, done.shortfallReason, done.shortfallQuantity]).toEqual(["moisture_loss", "humid day", "20.000"]);
    const use = await tx.select().from(mixingMaterialUse).where(eq(mixingMaterialUse.mixingRunId, f.run.id));
    expect(use.every((row) => row.formulaQuantity === row.usedQuantity)).toBe(true); // unchanged rows saved as used = formula
  }));
});
