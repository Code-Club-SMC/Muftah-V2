import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { user, products, warehouses, chemicals, packagingMaterials } from "@/db";
import { materialAdjustments } from "@/db/schemas/inventory-schema";
import { batchPackingReceipts, formulas, mixingMaterialUse, mixingRuns, packingMaterialUse, productionLossLimits } from "@/db/schemas/production-schema";
import { findOrCreateLot, type Tx } from "@/lib/inventory/material-lots.server";
import { DEFAULT_LOSS_LIMITS, type LossRow } from "@/lib/production/loss-report";
import { reportDateBounds } from "@/lib/report-dates";
import { loadLossRows, readLossLimits } from "@/server-functions/reports/production-loss-queries.server";
import { withRollback } from "./with-rollback";

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };
const october = reportDateBounds({ dateFrom: "2026-10-01", dateTo: "2026-10-31" }) as { fromDate: Date; toDate: Date };

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Ali", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: `${id}-surf` }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "500", batchUnit: "kg" }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const [shopper] = await tx.insert(packagingMaterials).values({ name: `${id}-shopper`, measuredInKg: true, weightPerPack: "1.000", pricePerKg: "520", costPerUnit: "520" }).returning();
  const [cap] = await tx.insert(packagingMaterials).values({ name: `${id}-cap`, type: "extra", costPerUnit: "2" }).returning();
  const [carton] = await tx.insert(packagingMaterials).values({ name: `${id}-carton`, type: "master", costPerUnit: "40" }).returning();
  const run = async (suffix: string, values: Partial<typeof mixingRuns.$inferInsert>) => (await tx.insert(mixingRuns).values({
    batchId: `${id}-${suffix}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, targetBulkQuantity: "500", bulkUnit: "kg", ...values,
  }).returning())[0];
  const short = await run("short", { status: "completed", actualBulkProduced: "400", totalChemicalCost: "150575", chemicalCostPerUnit: "376.4375", shortfallQuantity: "100", shortfallReasonCode: "spill", shortfallReason: "mixer seal", actualCompletionDate: new Date("2026-10-12T06:00:00Z") });
  await run("failed", { status: "failed", actualBulkProduced: "0", totalChemicalCost: "150575", actualCompletionDate: new Date("2026-10-12T07:00:00Z") });
  await run("full", { status: "completed", actualBulkProduced: "500", totalChemicalCost: "150575", actualCompletionDate: new Date("2026-10-12T08:00:00Z") });
  await run("september", { status: "completed", actualBulkProduced: "300", totalChemicalCost: "150575", actualCompletionDate: new Date("2026-09-12T06:00:00Z") });
  await tx.insert(mixingMaterialUse).values([
    { mixingRunId: short.id, chemicalId: soda.id, formulaQuantity: "50", usedQuantity: "55", extraQuantity: "5", extraCost: "575.00", reason: "spill" },
  ]);
  const [receipt] = await tx.insert(batchPackingReceipts).values({
    mixingRunId: short.id, requestId: id, requestPayload: "{}", actorId: actor.id, packedAt: new Date("2026-10-14T06:00:00Z"),
    bulkConsumed: "395", lossBulk: "5", lossReasonCode: "stuck_in_machine", totalPacks: 1080, costAudit: { chemicalCost: "0", lossCostPolicy: "test" },
  }).returning();
  await tx.insert(packingMaterialUse).values([
    { receiptId: receipt.id, materialId: shopper.id, measuredInKg: true, neededQuantity: "1080", usedQuantity: "1.2", extraCost: "62.40", totalCost: "624.00", shopperWeightGrams: "1.000", expectedShoppers: 1200, actualShoppers: 1080, lossShoppers: 120 },
    { receiptId: receipt.id, materialId: cap.id, measuredInKg: false, neededQuantity: "1080", usedQuantity: "1110", extraQuantity: "30", extraCost: "60.00", totalCost: "2220.00", reason: "broken" },
    { receiptId: receipt.id, materialId: carton.id, measuredInKg: false, neededQuantity: "45", usedQuantity: "45", totalCost: "1800.00" },
  ]);
  const lot = await findOrCreateLot(tx, { materialType: "chemical", materialId: soda.id }, "115");
  const adjustment = { warehouseId: floor.id, materialType: "chemical", chemicalId: soda.id, lotId: lot.id, unitPrice: "115.00", source: "manual", performedById: actor.id };
  await tx.insert(materialAdjustments).values([
    { ...adjustment, delta: "-2.000", value: "-230.00", reason: "count_short", createdAt: new Date("2026-10-18T05:00:00Z") },
    { ...adjustment, delta: "1.000", value: "115.00", reason: "count_over", createdAt: new Date("2026-10-18T05:00:00Z") },
    { ...adjustment, delta: "-1.000", value: "-115.00", reason: "damaged", createdAt: new Date("2026-09-18T05:00:00Z") },
  ]);
  return { id, short, floor };
}

// Other suites may leave rows, so only this seed's rows are checked.
const mine = (rows: LossRow[], id: string) => rows.filter((row) => ("batchId" in row ? row.batchId.startsWith(id) : row.tab === "store" && row.store === id));

describe.skipIf(!process.env.TEST_DATABASE_URL)("production loss queries", () => {
  it("reads each loss once, with its cost, and leaves out what is not loss", () => withRollback(async (tx) => {
    const f = await seed(tx);
    const load = async (tab: Parameters<typeof loadLossRows>[1]) => mine(await loadLossRows(tx, tab, october, DEFAULT_LOSS_LIMITS), f.id);

    const batch = await load("batch");
    expect(batch.map((r) => r.tab === "batch" && [r.batchId, r.loss, r.percent, r.cost, r.reason, r.over])).toEqual([[`${f.id}-short`, "100.000", "20.0", "30115.00", 'Spill · "mixer seal"', true]]);

    const chemical = await load("chemical");
    expect(chemical.map((r) => r.tab === "chemical" && [r.extra, r.percent, r.cost, r.reason])).toEqual([["5.000", "10.0", "575.00", "Spill"]]);

    const powder = await load("powder");
    expect(powder.map((r) => r.tab === "powder" && [r.given, r.percent, r.cost, r.reason])).toEqual([["400.000", "1.3", "1882.19", "Stuck in machine"]]);

    const packing = await load("packing");
    expect(packing.map((r) => r.tab === "packing" && [r.shopper, r.needed, r.used, r.loss, r.cost, r.reason]).sort()).toEqual([
      [false, "1080.000", "1110.000", "30.000", "60.00", "Broken"],
      [true, "1200", "1080", "120", "62.40", "Measured"],
    ].sort());

    const store = await load("store");
    expect(store.map((r) => r.tab === "store" && [r.quantity, r.cost, r.reason, r.by, r.lotPrice])).toEqual([["2.000", "230.00", "Count short", "Ali", "115.00"]]);
  }));

  it("uses saved limits and falls back to 10%", () => withRollback(async (tx) => {
    await tx.delete(productionLossLimits);
    expect((await readLossLimits(tx)).limits).toEqual(DEFAULT_LOSS_LIMITS);
    const f = await seed(tx);
    await tx.insert(productionLossLimits).values({ batch: "25.0", updatedBy: null });
    const { limits } = await readLossLimits(tx);
    expect(limits.batch).toBe("25.0");
    const [row] = mine(await loadLossRows(tx, "batch", october, limits), f.id);
    expect(row.over).toBe(false); // 20.0% is not above 25%
  }));
});
