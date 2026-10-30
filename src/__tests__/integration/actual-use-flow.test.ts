import { randomUUID } from "node:crypto";
import Big from "big.js";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, products, warehouses, chemicals, packagingMaterials, recipes } from "@/db";
import { materialAdjustments, recipePackaging } from "@/db/schemas/inventory-schema";
import { formulas, formulaIngredients, mixingRuns, packagingAllocations, packingMaterialUse } from "@/db/schemas/production-schema";
import { findOrCreateLot, lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
import { logMixingProgressFn } from "@/server-functions/manufacturing/mixing/log-mixing-progress-fn";
import { completeMixingRunFn } from "@/server-functions/manufacturing/mixing/complete-mixing-run-fn";
import { recordBatchPackingCore } from "@/server-functions/manufacturing/packaging/batch-packing-core.server";
import { adjustStockFn } from "@/server-functions/inventory/stock/adjust-stock-fn";
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
  requireInventoryManageMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

// The spec's example: one floor, a 400 kg formula of Soda Ash 50 + LABSA 30 + Silicate 20,
// and a 100 g format, 24 per carton, packed in a KG shopper with a cap per pack.
async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Floor manager", email: `${id}@test.invalid` }).returning();
  // Stock adjustments use the one active floor, so other floors are switched off inside the rollback.
  await tx.update(warehouses).set({ isActive: false }).where(eq(warehouses.type, "factory_floor"));
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "400", batchUnit: "kg" }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const [labsa] = await tx.insert(chemicals).values({ name: `${id}-labsa`, unit: "kg", costPerUnit: "300" }).returning();
  const [silicate] = await tx.insert(chemicals).values({ name: `${id}-silicate`, unit: "kg", costPerUnit: "90" }).returning();
  await tx.insert(formulaIngredients).values([
    { formulaId: formula.id, chemicalId: soda.id, quantityPerBatch: "50" },
    { formulaId: formula.id, chemicalId: labsa.id, quantityPerBatch: "30" },
    { formulaId: formula.id, chemicalId: silicate.id, quantityPerBatch: "20" },
  ]);
  const [shopper] = await tx.insert(packagingMaterials).values({ name: `${id}-shopper`, measuredInKg: true, weightPerPack: "1.000", pricePerKg: "520", costPerUnit: "520" }).returning();
  const [cap] = await tx.insert(packagingMaterials).values({ name: `${id}-cap`, type: "extra", costPerUnit: "2" }).returning();
  const [carton] = await tx.insert(packagingMaterials).values({ name: `${id}-carton`, type: "master", costPerUnit: "40" }).returning();
  const [format] = await tx.insert(recipes).values({
    name: `${id}-100g`, productId: product.id, formulaId: formula.id, batchSize: "400", batchUnit: "kg", fillAmount: "100", fillUnit: "g",
    containerType: "pack", containerPackagingId: shopper.id, containersPerCarton: 24, cartonPackagingId: carton.id,
  }).returning();
  await tx.insert(recipePackaging).values({ recipeId: format.id, packagingMaterialId: cap.id, quantityPerContainer: "1", usageBasis: "per_unit" });

  const ref = (materialType: "chemical" | "packaging", materialId: string) => ({ materialType, materialId });
  const sodaRef = ref("chemical", soda.id), labsaRef = ref("chemical", labsa.id), silicateRef = ref("chemical", silicate.id);
  const shopperRef = ref("packaging", shopper.id), capRef = ref("packaging", cap.id), cartonRef = ref("packaging", carton.id);
  await lockMaterialStock(tx, [floor.id], [sodaRef, labsaRef, silicateRef, shopperRef, capRef, cartonRef]);
  const stock = async (materialRef: typeof sodaRef, price: string, quantity: string) => {
    const lot = await findOrCreateLot(tx, materialRef, price);
    await moveLotStock(tx, { ref: materialRef, lotId: lot.id, warehouseId: floor.id, delta: quantity, sourceType: "purchase" });
    return lot;
  };
  const lots = {
    soda115: await stock(sodaRef, "115", "100"),
    labsa: await stock(labsaRef, "300", "100"),
    silicate: await stock(silicateRef, "90", "50"),
    shopper: await stock(shopperRef, "520", "5"),
    cap: await stock(capRef, "2", "2000"),
    carton: await stock(cartonRef, "40", "100"),
  };
  const newRun = async () => {
    const [run] = await tx.insert(mixingRuns).values({
      batchId: `T-${randomUUID()}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
      targetBulkQuantity: "400", bulkUnit: "kg", status: "scheduled",
    }).returning();
    return run;
  };
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: ["manufacturing.run.manage"] } };
  return { actor, context, floor, format, soda, labsa, silicate, shopper, cap, carton, sodaRef, lots, newRun };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("actual material use, whole flow", () => {
  it("mixes, packs, adjusts and keeps oldest stock first", () => withRollback(async (tx) => {
    const f = await seed(tx);

    // Mixing: start with the formula amounts, log 400 kg, then complete with what was really used.
    const run = await f.newRun();
    await startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [
      { materialId: f.soda.id, picks: [{ lotId: f.lots.soda115.id, quantity: "50" }] },
      { materialId: f.labsa.id, picks: [{ lotId: f.lots.labsa.id, quantity: "30" }] },
      { materialId: f.silicate.id, picks: [{ lotId: f.lots.silicate.id, quantity: "20" }] },
    ] }, context: f.context } as never);
    await logMixingProgressFn({ data: { mixingRunId: run.id, quantityProduced: 400 }, context: f.context } as never);
    await completeMixingRunFn({ data: { mixingRunId: run.id, uses: [
      { chemicalId: f.soda.id, used: "55", picks: [{ lotId: f.lots.soda115.id, quantity: "5" }], reason: "spill" },
      { chemicalId: f.silicate.id, used: "18", picks: [{ lotId: f.lots.silicate.id, quantity: "2" }] },
    ] }, context: f.context } as never);
    const [mixed] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, run.id));
    expect(mixed.status).toBe("completed");
    expect(mixed.totalChemicalCost).toBe("16945.00"); // formula 16,550 + 5 × 115 − 2 × 90
    expect(mixed.chemicalCostPerUnit).toBe("42.3625"); // 16,945 ÷ 400

    // Packing: 45 full cartons = 1,080 packs = 108 kg of the batch.
    const packed = await recordBatchPackingCore(tx, {
      mixingRunId: run.id, requestId: randomUUID(), packedAt: new Date("2026-10-30T09:00:00Z"), lossBulk: "0",
      lines: [{ recipeId: f.format.id, fullCartons: 45, partialPacks: 0, loosePacks: 0 }],
      lotPicks: [
        { materialId: f.shopper.id, used: "1.2", picks: [{ lotId: f.lots.shopper.id, quantity: "1.2" }] },
        { materialId: f.cap.id, used: "1110", reason: "broken", picks: [{ lotId: f.lots.cap.id, quantity: "1110" }] },
        { materialId: f.carton.id, used: "45", picks: [{ lotId: f.lots.carton.id, quantity: "45" }] },
      ],
    }, { id: f.actor.id, permissions: ["manufacturing.run.manage"] });
    const use = await tx.select().from(packingMaterialUse).where(eq(packingMaterialUse.receiptId, packed.receiptId));
    const shopperUse = use.find((row) => row.materialId === f.shopper.id)!;
    expect([shopperUse.expectedShoppers, shopperUse.actualShoppers, shopperUse.lossShoppers]).toEqual([1200, 1080, 120]);
    const capUse = use.find((row) => row.materialId === f.cap.id)!;
    expect([capUse.neededQuantity, capUse.usedQuantity, capUse.extraQuantity, capUse.extraCost, capUse.reason]).toEqual(["1080.000", "1110.000", "30.000", "60.00", "broken"]);
    const [allocation] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.packingReceiptId, packed.receiptId));
    expect(allocation.allocatedChemicalCost).toBe("4575.15"); // 16,945 × 108 ÷ 400
    expect(allocation.totalPackagingCost).toBe("4644.00"); // shopper 624 + caps 2,220 + cartons 1,800
    expect(allocation.actualCostPerPack).toBe(new Big(allocation.allocatedChemicalCost).plus(624).plus(2220).plus(1800).div(1080).toFixed(4));

    // Adjustment: half a KG of shoppers damaged.
    await adjustStockFn({ data: { materialType: "packaging", materialId: f.shopper.id, lotId: f.lots.shopper.id, adjustment: -0.5, reason: "damaged" }, context: f.context } as never);
    const adjustments = await tx.select().from(materialAdjustments)
      .where(and(eq(materialAdjustments.warehouseId, f.floor.id), eq(materialAdjustments.packagingMaterialId, f.shopper.id)));
    expect(adjustments.map((row) => [row.delta, row.value, row.reason])).toEqual([["-0.500", "-260.00", "damaged"]]);

    // Oldest first: a newer Soda Ash lot can't be used while 45 kg of the older one is left.
    const soda125 = await findOrCreateLot(tx, f.sodaRef, "125");
    await moveLotStock(tx, { ref: f.sodaRef, lotId: soda125.id, warehouseId: f.floor.id, delta: "100", sourceType: "purchase" });
    const second = await f.newRun();
    const others = [
      { materialId: f.labsa.id, picks: [{ lotId: f.lots.labsa.id, quantity: "30" }] },
      { materialId: f.silicate.id, picks: [{ lotId: f.lots.silicate.id, quantity: "20" }] },
    ];
    await expect(startMixingRunFn({ data: { mixingRunId: second.id, lotPicks: [
      { materialId: f.soda.id, picks: [{ lotId: soda125.id, quantity: "50" }] }, ...others,
    ] }, context: f.context } as never)).rejects.toThrow("use the oldest stock first");
    await startMixingRunFn({ data: { mixingRunId: second.id, lotPicks: [
      { materialId: f.soda.id, picks: [{ lotId: f.lots.soda115.id, quantity: "45" }, { lotId: soda125.id, quantity: "5" }] }, ...others,
    ] }, context: f.context } as never);
    const [started] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, second.id));
    expect(started.status).toBe("in_progress");
  }));
});
