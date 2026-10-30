import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, user, warehouses, products, packagingMaterials, materialStock, recipes, finishedGoodsStock, cartons, invoiceItems, inventoryAuditLog, wacHistory } from "@/db";
import { batchPackingReceipts, formulas, mixingRuns, packagingAllocations, outsidePackMovements, packagingMaterialsUsed } from "@/db/schemas/production-schema";
import { packingAvailability, recordBatchPackingCore, type BatchPackingInput, type PackingActor } from "@/server-functions/manufacturing/packaging/batch-packing-core.server";
import { findOrCreateLot, listLotBalances, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { calculatePackingLine, packingMaterialNeeds } from "@/lib/production/batch-packing";
import { postInvoice } from "@/server-functions/sales/invoice-posting-service";
import { reverseInvoiceStock } from "@/lib/cartons/invoice-stock.server";
import { recordSalesReturnCartons } from "@/lib/cartons/sales-return.server";
import { adjustCartonStock } from "@/lib/cartons/stock-adjustment.server";
import { transferFinishedStock } from "@/server-functions/inventory/stock/transfer-stock-core.server";
import { updateOutsidePackStockCore } from "@/server-functions/inventory/stock/update-outside-pack-stock-core.server";
import { getBatchKpis } from "@/lib/cartons/carton.repository";
import { addCartonsToBatch } from "@/lib/cartons/carton.service";
import { createInvoiceSchema } from "@/db/zod_schemas";
import { fixture, record, seed, type Tx } from "./batch-packing-fixture";

const stockWhere = (f: Awaited<ReturnType<typeof seed>>, recipeId = f.formats[0].id) => and(eq(finishedGoodsStock.warehouseId, f.warehouse.id), eq(finishedGoodsStock.recipeId, recipeId));

describe("batch packing isolated PostgreSQL", () => {
  it("posts the whole 500kg receipt atomically and replays without duplicate stock", async () => fixture(async (tx, f) => {
    const result = await record(tx, f.input, f.actor);
    expect(await record(tx, f.input, f.actor)).toEqual(result);
    await expect(tx.transaction(inner => record(inner, { ...f.input, lossBulk: "1", lossReason: "machine_fault" }, f.actor))).rejects.toThrow("different packing details");
    const rows = await tx.select().from(cartons).where(eq(cartons.warehouseId, f.warehouse.id));
    expect(rows).toHaveLength(40);
    expect(rows.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(1250);
    const stocks = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id));
    expect(stocks.reduce((sum, row) => sum + row.quantityOutsidePacks, 0)).toBe(100);
    expect((await packingAvailability(tx, f.run)).toFixed(3)).toBe("0.000");
    expect(await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, f.run.id))).toHaveLength(1);
    const allocations = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.mixingRunId, f.run.id));
    expect(allocations).toHaveLength(4);
    expect(allocations.every(row => row.status === "completed" && row.formatSnapshot?.name)).toBe(true);
    const [packs] = await tx.select().from(materialStock).where(eq(materialStock.packagingMaterialId, f.primary.id));
    const [boxes] = await tx.select().from(materialStock).where(eq(materialStock.packagingMaterialId, f.master.id));
    expect(Number(packs.quantity)).toBe(8650);
    expect(Number(boxes.quantity)).toBe(960);
  }));
  it("keeps partial cartons and oversized outside counts distinct, consumes measured bulk and absorbs loss cost", async () => fixture(async (tx, f) => {
    const input = { ...f.input, lossBulk: "1", lossReason: "spill" as const, lines: [{ recipeId: f.formats[0].id, fullCartons: 1, partialPacks: 3, loosePacks: 101, actualBulk: "37", varianceReason: "Measured fill" }] };
    const result = await record(tx, input, f.actor);
    const [receipt] = await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.id, result.receiptId));
    expect(receipt.bulkConsumed).toBe("37.000");
    expect(receipt.lossBulk).toBe("1.000");
    expect(receipt.costAudit.chemicalCost).toBe("380.00");
    expect((await packingAvailability(tx, f.run)).toFixed(3)).toBe("462.000");
    expect(await tx.select().from(cartons).where(eq(cartons.warehouseId, f.warehouse.id))).toHaveLength(2);
    const [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityOutsidePacks).toBe(101);
    expect(stock.quantityCartons * 40 + stock.quantityContainers).toBe(144);
    expect(Number(stock.totalInventoryValue)).toBe(678);
  }));
  it("costs packaging at the picked lot prices", async () => fixture(async (tx, f) => {
    const cartonRef = { materialType: "packaging" as const, materialId: f.master.id };
    const dearer = await findOrCreateLot(tx, cartonRef, "6");
    await moveLotStock(tx, { ref: cartonRef, lotId: dearer.id, warehouseId: f.warehouse.id, delta: "5", sourceType: "purchase" });
    // Leave one carton in the older lot, so taking one from each is oldest first.
    await moveLotStock(tx, { ref: cartonRef, lotId: f.cartonLot.id, warehouseId: f.warehouse.id, delta: "-999", sourceType: "adjustment" });
    const lotPicks = [
      { materialId: f.primary.id, picks: [{ lotId: f.packLot.id, quantity: "80" }] },
      { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "1" }, { lotId: dearer.id, quantity: "1" }] },
    ];
    const result = await record(tx, { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 2, partialPacks: 0, loosePacks: 0 }], lotPicks }, f.actor);
    const [allocation] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.packingReceiptId, result.receiptId));
    const used = await tx.select().from(packagingMaterialsUsed).where(and(eq(packagingMaterialsUsed.packagingAllocationId, allocation.id), eq(packagingMaterialsUsed.materialId, f.master.id)));
    expect(used.map(row => [row.lotId, row.quantityUsed, row.costPerUnit, row.totalCost]).sort()).toEqual([
      [f.cartonLot.id, "1.000", "5.00", "5.00"], [dearer.id, "1.000", "6.00", "6.00"],
    ].sort());
    expect(allocation.totalPackagingCost).toBe("171.00");
  }));
  it("splits a lot shared by two formats by how many each used", async () => fixture(async (tx, f) => {
    const cartonRef = { materialType: "packaging" as const, materialId: f.master.id };
    const dearer = await findOrCreateLot(tx, cartonRef, "6");
    await moveLotStock(tx, { ref: cartonRef, lotId: dearer.id, warehouseId: f.warehouse.id, delta: "5", sourceType: "purchase" });
    // Leave one carton in the older lot, so taking one from each is oldest first.
    await moveLotStock(tx, { ref: cartonRef, lotId: f.cartonLot.id, warehouseId: f.warehouse.id, delta: "-999", sourceType: "adjustment" });
    const lines = [{ recipeId: f.formats[0].id, fullCartons: 1, partialPacks: 0, loosePacks: 0 }, { recipeId: f.formats[1].id, fullCartons: 1, partialPacks: 0, loosePacks: 0 }];
    const lotPicks = [
      { materialId: f.primary.id, picks: [{ lotId: f.packLot.id, quantity: "60" }] },
      { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "1" }, { lotId: dearer.id, quantity: "1" }] },
    ];
    const result = await record(tx, { ...f.input, lines, lotPicks }, f.actor);
    const allocations = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.packingReceiptId, result.receiptId));
    const used = await tx.select().from(packagingMaterialsUsed).where(and(inArray(packagingMaterialsUsed.packagingAllocationId, allocations.map(row => row.id)), eq(packagingMaterialsUsed.materialId, f.master.id)));
    expect(used).toHaveLength(4);
    expect(used.every(row => row.quantityUsed === "0.500")).toBe(true);
    expect(used.reduce((sum, row) => sum + Number(row.totalCost), 0)).toBe(11);
    expect(allocations.reduce((sum, row) => sum + Number(row.totalPackagingCost), 0)).toBe(131);
  }));
  it("refuses packing when picks do not cover a material", async () => fixture(async (tx, f) => {
    const lotPicks = [{ materialId: f.primary.id, picks: [{ lotId: f.packLot.id, quantity: "80" }] }];
    await expect(record(tx, { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 2, partialPacks: 0, loosePacks: 0 }], lotPicks }, f.actor)).rejects.toThrow("Pick lots for");
  }));
  it("rolls back all lines on shortages and rejects wrong formulas, assignment and read-only permission", async () => fixture(async (tx, f) => {
    await moveLotStock(tx, { ref: { materialType: "packaging", materialId: f.master.id }, lotId: f.cartonLot.id, warehouseId: f.warehouse.id, delta: "-999", sourceType: "adjustment" });
    const failed = () => tx.transaction(inner => record(inner, f.input, f.actor));
    await expect(failed()).rejects.toThrow("has only 1 pcs here");
    expect(await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, f.run.id))).toHaveLength(0);
    expect(await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id))).toHaveLength(0);
    expect(await tx.select().from(packagingMaterialsUsed).where(eq(packagingMaterialsUsed.materialId, f.primary.id))).toHaveLength(0);
    const [packs] = await tx.select().from(materialStock).where(eq(materialStock.packagingMaterialId, f.primary.id));
    expect(Number(packs.quantity)).toBe(10000);
    await expect(tx.transaction(inner => record(inner, f.input, { id: "someone-else", permissions: ["operator.run.complete"] }))).rejects.toThrow("another operator");
    await expect(tx.transaction(inner => record(inner, f.input, { id: f.actor.id, permissions: ["operator.run.read"] }))).rejects.toThrow("permission");
    await tx.update(recipes).set({ formulaId: null }).where(eq(recipes.id, f.formats[0].id));
    await expect(failed()).rejects.toThrow("linked");
  }));
  it("dispatches outside packs without changing cartons, restores them on reversal and good return, then transfers them", async () => fixture(async (tx, f) => {
    await record(tx, { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 1, partialPacks: 3, loosePacks: 101 }] }, f.actor);
    const request = { ...createInvoiceSchema.parse({ customerName: "Test", warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"), items: [{ recipeId: f.formats[0].id, pack: f.formats[0].name, unitType: "units", numberOfUnits: 50, numberOfCartons: 0, packsPerCarton: 40, perCartonPrice: 800, retailPrice: 20, isPriceOverride: true }] }), performedById: f.actor.id, source: "offline_import" as const, publicInvoiceNumber: randomUUID(), businessDate: new Date(), stockPolicy: "strict" as const, creditPolicy: "block" as const, pricingPolicy: "live" as const };
    const invoice = await postInvoice(tx, request);
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
    let [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityOutsidePacks).toBe(51);
    expect((await tx.select().from(cartons).where(eq(cartons.warehouseId, f.warehouse.id))).reduce((sum, row) => sum + row.currentPacks, 0)).toBe(43);
    await reverseInvoiceStock(tx, { invoiceId: invoice.id, warehouseId: f.warehouse.id, userId: f.actor.id, items, dispatchedUnits: item => Number(item.dispatchedUnits) });
    [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityOutsidePacks).toBe(101);
    const next = await postInvoice(tx, { ...request, publicInvoiceNumber: randomUUID(), items: request.items.map(item => ({ ...item, numberOfUnits: 80 })) });
    await recordSalesReturnCartons(tx, { invoiceId: next.id, salesReturnId: randomUUID(), recipeId: f.formats[0].id, warehouseId: f.warehouse.id, units: 10, good: true, userId: f.actor.id });
    await adjustCartonStock(tx, { warehouseId: f.warehouse.id, recipeId: f.formats[0].id }, 10, f.actor.id, next.id, 10);
    [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityOutsidePacks).toBe(31);
    await transferFinishedStock(tx, { fromWarehouseId: f.warehouse.id, toWarehouseId: f.target.id, recipeId: f.formats[0].id, cartons: 1, looseUnits: 20, userId: f.actor.id, referenceId: randomUUID() });
    [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    const [target] = await tx.select().from(finishedGoodsStock).where(and(eq(finishedGoodsStock.warehouseId, f.target.id), eq(finishedGoodsStock.recipeId, f.formats[0].id)));
    expect(stock.quantityOutsidePacks).toBe(11);
    expect(target.quantityOutsidePacks).toBe(20);
    expect(await tx.select().from(cartons).where(eq(cartons.warehouseId, f.target.id))).toHaveLength(1);
    expect(target.quantityCartons * 40 + target.quantityContainers).toBe(60);
  }));
  it("keeps completed legacy reservation untouched", async () => fixture(async (tx, f) => {
    await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.formats[0].id, warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: "480", allocatedBulkUnit: "kg", allocatedChemicalCost: "4800", targetContainers: 100, actualBulkConsumed: "25", status: "completed" });
    expect((await packingAvailability(tx, f.run)).toFixed(3)).toBe("20.000");
    await expect(tx.transaction(inner => record(inner, { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 0, partialPacks: 0, loosePacks: 100 }] }, f.actor))).rejects.toThrow("available");
  }));
  it("allocates tiny chemical costs cumulatively across repeated receipts and loss", async () => fixture(async (tx, f) => {
    await tx.update(mixingRuns).set({ actualBulkProduced: "3", totalChemicalCost: "0.02" }).where(eq(mixingRuns.id, f.run.id));
    for (let index = 0; index < 3; index++) await record(tx, { ...f.input, requestId: randomUUID(), lines: [{ recipeId: f.formats[0].id, fullCartons: 0, partialPacks: 0, loosePacks: 3 }], lossBulk: "0.25", lossReason: "other", lossNote: "Powder loss" }, f.actor);
    const receipts = await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, f.run.id));
    expect(receipts.map(row => row.costAudit.chemicalCost).sort()).toEqual(["0.00", "0.01", "0.01"]);
    const allocations = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.mixingRunId, f.run.id));
    expect(allocations.reduce((sum, row) => sum + Number(row.allocatedChemicalCost), 0)).toBe(0.02);
    const [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.totalInventoryValue).toBe("18.02");
  }));
  it("retains legacy reserved cost and bulk while splitting the remaining tiny cost", async () => fixture(async (tx, f) => {
    await tx.update(mixingRuns).set({ actualBulkProduced: "4", totalChemicalCost: "0.02" }).where(eq(mixingRuns.id, f.run.id));
    await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.formats[0].id, warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: "1", allocatedBulkUnit: "kg", allocatedChemicalCost: "0.01", targetContainers: 4, status: "allocated" });
    for (let index = 0; index < 3; index++) await record(tx, { ...f.input, requestId: randomUUID(), lines: [{ recipeId: f.formats[3].id, fullCartons: 0, partialPacks: 0, loosePacks: 1 }] }, f.actor);
    const allocations = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.mixingRunId, f.run.id));
    expect(allocations.reduce((sum, row) => sum + Number(row.allocatedChemicalCost), 0)).toBe(0.02);
    expect(allocations.find(row => !row.packingReceiptId)?.allocatedChemicalCost).toBe("0.01");
    expect((await packingAvailability(tx, { ...f.run, actualBulkProduced: "4" })).toFixed(3)).toBe("0.000");
  }));
  it("corrects outside packs with quantity and value audits while preserving physical cartons", async () => fixture(async (tx, f) => {
    await record(tx, { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 1, partialPacks: 3, loosePacks: 101 }] }, f.actor);
    let [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    const correction = { stockId: stock.id, adjustmentType: "set" as const, quantity: 0, expectedCurrent: 101, reason: "Counted factory packs" };
    expect(await updateOutsidePackStockCore(tx, correction, f.actor.id)).toEqual({ success: true, stockId: stock.id, quantityOutsidePacks: 0 });
    await expect(tx.transaction(inner => updateOutsidePackStockCore(inner, correction, f.actor.id))).rejects.toThrow("Stock changed");
    await expect(tx.transaction(inner => updateOutsidePackStockCore(inner, { ...correction, adjustmentType: "subtract", quantity: 1, expectedCurrent: 0 }, f.actor.id))).rejects.toThrow("Insufficient");
    [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityCartons * 40 + stock.quantityContainers).toBe(43);
    // Receipt cost is 360 chemical + 288 packs + 10 cartons = 658.
    // Removing 101/144 of that value leaves 196.49 for the 43 carton packs.
    expect(stock.totalInventoryValue).toBe("196.49");
    const physical = await tx.select().from(cartons).where(eq(cartons.warehouseId, f.warehouse.id));
    expect(physical.map(row => row.currentPacks).sort((a, b) => a - b)).toEqual([3, 40]);
    const [audit] = await tx.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.referenceId, stock.id));
    expect(audit.reason).toBe("Outside pack correction: Counted factory packs");
    expect(audit.amount).toBe("101.000");
    expect(audit.type).toBe("debit");
    const history = await tx.select().from(wacHistory).where(eq(wacHistory.recipeId, f.formats[0].id));
    expect(history).toHaveLength(2);
    await updateOutsidePackStockCore(tx, { ...correction, adjustmentType: "add", quantity: 2, expectedCurrent: 0 }, f.actor.id);
    await updateOutsidePackStockCore(tx, { ...correction, adjustmentType: "subtract", quantity: 1, expectedCurrent: 2 }, f.actor.id);
    [stock] = await tx.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityOutsidePacks).toBe(1);
    expect(stock.quantityCartons * 40 + stock.quantityContainers).toBe(44);
    expect(await tx.select().from(cartons).where(eq(cartons.warehouseId, f.warehouse.id))).toHaveLength(2);
  }));
  it("normalizes legacy no-carton stock on a new receipt, correction and transfer", async () => fixture(async (tx, f) => {
    const [old] = await tx.insert(finishedGoodsStock).values({ warehouseId: f.warehouse.id, recipeId: f.formats[3].id, quantityContainers: 100, weightedAverageCostPerPack: "12", totalInventoryValue: "1200" }).returning();
    await record(tx, { ...f.input, lines: [{ recipeId: f.formats[3].id, fullCartons: 0, partialPacks: 0, loosePacks: 10 }] }, f.actor);
    let [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.id, old.id));
    expect(stock.quantityOutsidePacks).toBe(110);
    await updateOutsidePackStockCore(tx, { stockId: old.id, adjustmentType: "set", quantity: 100, expectedCurrent: 110, reason: "Counted all packs" }, f.actor.id);
    await transferFinishedStock(tx, { fromWarehouseId: f.warehouse.id, toWarehouseId: f.target.id, recipeId: f.formats[3].id, looseUnits: 70, userId: f.actor.id, referenceId: randomUUID() });
    [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.id, old.id));
    const [target] = await tx.select().from(finishedGoodsStock).where(and(eq(finishedGoodsStock.warehouseId, f.target.id), eq(finishedGoodsStock.recipeId, f.formats[3].id)));
    expect([stock.quantityContainers, stock.quantityOutsidePacks]).toEqual([30, 30]);
    expect([target.quantityContainers, target.quantityOutsidePacks]).toEqual([70, 70]);
    expect(await tx.select().from(cartons).where(eq(cartons.recipeId, f.formats[3].id))).toHaveLength(0);
  }));
  it("uses recorded physical carton targets when outside packs exceed capacity", async () => {
    const f = await db.transaction(seed);
    try {
    const result = await db.transaction(tx => record(tx, { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 1, partialPacks: 3, loosePacks: 101 }] }, f.actor));
    const [allocation] = await db.select().from(packagingAllocations).where(eq(packagingAllocations.packingReceiptId, result.receiptId));
    const kpis = await getBatchKpis(allocation.id);
    expect(kpis.totalCartons).toBe(2);
    expect(kpis.targetCartons).toBe(2);
    expect(kpis.shortfallCartons).toBe(0);
    await expect(addCartonsToBatch(allocation.id, 1, f.actor.id)).rejects.toThrow("Additional cartons exceed");
    } finally {
      await db.update(warehouses).set({ isActive: false }).where(inArray(warehouses.id, [f.warehouse.id, f.target.id]));
    }
  });
  it("serializes concurrent submissions and retries without overdraw", async () => {
    if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Use isolated TEST_DATABASE_URL");
    // Committed fixtures are confined to the disposable isolated test database.
    const f = await db.transaction(seed);
    try {
    const input = { ...f.input, lines: [{ recipeId: f.formats[0].id, fullCartons: 30, partialPacks: 0, loosePacks: 0 }] };
    const outcomes = await Promise.allSettled([
      db.transaction(tx => record(tx, input, f.actor)),
      db.transaction(tx => record(tx, { ...input, requestId: randomUUID() }, f.actor)),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    const [receipt] = await db.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, f.run.id));
    const successfulInput = { ...input, requestId: receipt.requestId };
    const retries = await Promise.all([
      db.transaction(tx => record(tx, successfulInput, f.actor)),
      db.transaction(tx => record(tx, successfulInput, f.actor)),
    ]);
    expect(retries[0].receiptId).toBe(receipt.id);
    expect(retries[1]).toEqual(retries[0]);
    expect(await db.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, f.run.id))).toHaveLength(1);
    const [stock] = await db.select().from(finishedGoodsStock).where(stockWhere(f));
    expect(stock.quantityCartons * 40 + stock.quantityContainers).toBe(1200);
    } finally {
      await db.update(warehouses).set({ isActive: false }).where(inArray(warehouses.id, [f.warehouse.id, f.target.id]));
    }
  });

});
