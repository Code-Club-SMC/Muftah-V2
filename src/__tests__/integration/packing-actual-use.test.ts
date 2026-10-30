import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { packagingMaterials } from "@/db";
import { batchPackingReceipts, packagingAllocations, packingMaterialUse } from "@/db/schemas/production-schema";
import { recordBatchPackingCore } from "@/server-functions/manufacturing/packaging/batch-packing-core.server";
import { findOrCreateLot, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { fixture, record } from "./batch-packing-fixture";

describe.skipIf(!process.env.TEST_DATABASE_URL)("packing with actual use", () => {
  it("takes the typed shopper KG from picked lots and saves expected, actual and loss", () => fixture(async (tx, f) => {
    await tx.update(packagingMaterials).set({ measuredInKg: true, weightPerPack: "1.000", pricePerKg: "520", costPerUnit: "520" }).where(eq(packagingMaterials.id, f.primary.id));
    const shopperRef = { materialType: "packaging" as const, materialId: f.primary.id };
    await lockMaterialStock(tx, [f.warehouse.id], [shopperRef]);
    const shopperLot = await findOrCreateLot(tx, shopperRef, "520");
    await moveLotStock(tx, { ref: shopperRef, lotId: shopperLot.id, warehouseId: f.warehouse.id, delta: "5", sourceType: "purchase" });
    // The seeded 2-rupee lot would come first, so empty it: shoppers now come only from the KG lot.
    await moveLotStock(tx, { ref: shopperRef, lotId: f.packLot.id, warehouseId: f.warehouse.id, delta: "-10000", sourceType: "adjustment" });
    // 27 cartons × 40 = 1,080 packs of 250 g = 270 kg bulk
    const lines = [{ recipeId: f.formats[0].id, fullCartons: 27, partialPacks: 0, loosePacks: 0 }];
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [
      { materialId: f.primary.id, picks: [{ lotId: shopperLot.id, quantity: "1.2" }] },
      { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "27" }] },
    ] }, f.actor)).rejects.toThrow("enter the KG used");

    const result = await recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [
      { materialId: f.primary.id, used: "1.2", picks: [{ lotId: shopperLot.id, quantity: "1.2" }] },
      { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "27" }] },
    ] }, f.actor);
    const [shopper] = await tx.select().from(packingMaterialUse).where(and(eq(packingMaterialUse.receiptId, result.receiptId), eq(packingMaterialUse.materialId, f.primary.id)));
    expect([shopper.measuredInKg, shopper.neededQuantity, shopper.usedQuantity, shopper.totalCost, shopper.shopperWeightGrams, shopper.expectedShoppers, shopper.actualShoppers, shopper.lossShoppers, shopper.extraCost])
      .toEqual([true, "1080.000", "1.200", "624.00", "1.000", 1200, 1080, 120, "62.40"]);
    const [allocation] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.packingReceiptId, result.receiptId));
    expect(allocation.totalPackagingCost).toBe("759.00"); // 624 shopper + 27 × 5 carton
  }));

  it("takes extra pieces with a reason and blocks fewer than needed", () => fixture(async (tx, f) => {
    const lines = [{ recipeId: f.formats[0].id, fullCartons: 2, partialPacks: 0, loosePacks: 0 }]; // 80 packs, 2 cartons
    const base = { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "2" }] };
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "79", picks: [{ lotId: f.packLot.id, quantity: "79" }] }, base] }, f.actor))
      .rejects.toThrow("used can't be less than needed (80). Check the pack count instead.");
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "83", picks: [{ lotId: f.packLot.id, quantity: "83" }] }, base] }, f.actor))
      .rejects.toThrow("Pick a reason for extra");
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "83", reason: "broken", picks: [{ lotId: f.packLot.id, quantity: "80" }] }, base] }, f.actor))
      .rejects.toThrow("but 83 pcs is needed");
    const result = await recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "83", reason: "broken", picks: [{ lotId: f.packLot.id, quantity: "83" }] }, base] }, f.actor);
    const [pack] = await tx.select().from(packingMaterialUse).where(and(eq(packingMaterialUse.receiptId, result.receiptId), eq(packingMaterialUse.materialId, f.primary.id)));
    expect([pack.neededQuantity, pack.usedQuantity, pack.extraQuantity, pack.extraCost, pack.reason]).toEqual(["80.000", "83.000", "3.000", "6.00", "broken"]);
  }));

  it("saves the powder loss reason code and its note", () => fixture(async (tx, f) => {
    // The seeded input packs all 500 kg, so pack less to leave room for the loss.
    const input = { ...f.input, lines: [f.input.lines[0]] };
    await expect(record(tx, { ...input, lossBulk: "1" }, f.actor)).rejects.toThrow("Pick a reason for powder loss");
    const result = await record(tx, { ...input, lossBulk: "1", lossReason: "stuck_in_machine", lossNote: "hopper" }, f.actor);
    const [receipt] = await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.id, result.receiptId));
    expect([receipt.lossReasonCode, receipt.lossReason]).toEqual(["stuck_in_machine", "hopper"]);
  }));
});
