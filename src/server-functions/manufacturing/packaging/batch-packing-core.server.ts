import Big from "big.js";
import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { db } from "@/db";
import { batchPackingReceipts, formulas, mixingRuns, packagingAllocations, packagingMaterialsUsed, outsidePackMovements } from "@/db/schemas/production-schema";
import { finishedGoodsStock, inventoryAuditLog, materialStock, packagingMaterials, recipePackaging, recipes, warehouses, wacHistory } from "@/db/schemas/inventory-schema";
import { cartons, adjustmentLog } from "@/db/schemas/manufacturing-schema";
import { calculatePackingLine, packingBulk } from "@/lib/production/batch-packing";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";
import { hasPermission } from "@/lib/rbac";
import { normalizePackagingUsageBasis } from "@/lib/recipe-packaging";
import { z } from "zod";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const batchPackingSchema = z.object({
  mixingRunId: z.string().min(1), requestId: z.string().min(1).max(100), packedAt: z.coerce.date(),
  lines: z.array(z.object({ recipeId: z.string().min(1), fullCartons: z.number().int().nonnegative(), partialPacks: z.number().int().nonnegative(), loosePacks: z.number().int().nonnegative(), actualBulk: z.string().optional(), varianceReason: z.string().max(2000).optional() })).min(1).max(100),
  lossBulk: z.string(), lossReason: z.string().max(2000).optional(),
});
export type BatchPackingInput = z.infer<typeof batchPackingSchema>;
export type PackingActor = { id: string; permissions: readonly string[] | Set<string> };
export function authorizePacking(actor: PackingActor, operatorId: string, read = false) {
  const manager = hasPermission(actor.permissions, "manufacturing.run.manage");
  const manufacturingReader = read && (hasPermission(actor.permissions, "manufacturing.run.read") || hasPermission(actor.permissions, "manufacturing.view"));
  if (manager || manufacturingReader) return;
  if (actor.id !== operatorId) throw new Error("This mixing batch is assigned to another operator");
  if (!hasPermission(actor.permissions, read ? "operator.run.read" : "operator.run.complete")) throw new Error(read ? "You do not have permission to read this batch" : "You do not have permission to record packing");
}
export async function packingAvailability(tx: Tx, run: typeof mixingRuns.$inferSelect) {
  const [reserved] = await tx.select({ amount: sql<string>`coalesce(sum(${packagingAllocations.allocatedBulkQuantity}), 0)` }).from(packagingAllocations).where(and(eq(packagingAllocations.mixingRunId, run.id), ne(packagingAllocations.status, "cancelled")));
  const [loss] = await tx.select({ amount: sql<string>`coalesce(sum(${batchPackingReceipts.lossBulk}), 0)` }).from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, run.id));
  return new Big(run.actualBulkProduced ?? 0).minus(reserved.amount).minus(loss.amount);
}
export async function recordBatchPackingCore(tx: Tx, input: BatchPackingInput, actor: PackingActor) {
  const data = batchPackingSchema.parse(input);
  const [run] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, data.mixingRunId)).for("update");
  if (!run) throw new Error("Mixing batch not found");
  authorizePacking(actor, run.operatorId);
  const payload = JSON.stringify({ ...data, packedAt: data.packedAt.toISOString(), lines: [...data.lines].sort((a, b) => a.recipeId.localeCompare(b.recipeId)) });
  const [existing] = await tx.select().from(batchPackingReceipts).where(and(eq(batchPackingReceipts.mixingRunId, run.id), eq(batchPackingReceipts.requestId, data.requestId)));
  if (existing) {
    if (existing.requestPayload !== payload || existing.actorId !== actor.id) throw new Error("This request ID was already used with different packing details");
    return { success: true as const, receiptId: existing.id, mixingRunId: run.id };
  }
  if (run.status !== "completed") throw new Error("Complete the mixing batch before recording packing");
  const [warehouse] = await tx.select().from(warehouses).where(eq(warehouses.id, run.warehouseId)).for("share");
  if (!warehouse?.isActive || warehouse.type !== "factory_floor") throw new Error("An active factory floor is required");
  const [formula] = await tx.select().from(formulas).where(eq(formulas.id, run.formulaId)).for("share");
  const ids = data.lines.map(line => line.recipeId);
  if (new Set(ids).size !== ids.length) throw new Error("Each packaging format may appear only once");
  const formats = await tx.select().from(recipes).where(inArray(recipes.id, ids)).orderBy(recipes.id).for("share");
  const prepared = [...data.lines].sort((a, b) => a.recipeId.localeCompare(b.recipeId)).map(line => {
    const format = formats.find(row => row.id === line.recipeId);
    if (!format?.isActive || format.formulaId !== run.formulaId || format.productId !== formula?.productId) throw new Error("Choose an active packaging format linked to this batch formula and product");
    const usesCartons = !!format.cartonPackagingId && (format.containersPerCarton ?? 0) > 0;
    return { line, format, quantity: calculatePackingLine(line, { ...format, containersPerCarton: format.containersPerCarton ?? 0, usesCartons }, run.bulkUnit) };
  });
  const consumed = prepared.reduce((total, item) => total.plus(item.quantity.actualBulk), new Big(0));
  const lossBulk = packingBulk(data.lossBulk, "Powder loss");
  if (new Big(lossBulk).gt(0) && !data.lossReason?.trim()) throw new Error("Give a reason for powder loss");
  if (consumed.plus(lossBulk).gt(await packingAvailability(tx, run))) throw new Error("Packing and loss exceed the available batch bulk");
  const totalPacks = prepared.reduce((total, item) => total + item.quantity.totalPacks, 0);
  if (totalPacks > 2147483647) throw new Error("Total pack count exceeds the supported limit");
  const materials = await tx.select().from(packagingMaterials).orderBy(packagingMaterials.id).for("share");
  const extras = await tx.select().from(recipePackaging).where(inArray(recipePackaging.recipeId, ids)).orderBy(recipePackaging.id).for("share");
  const requirements = new Map<string, Big>();
  const lineRequirements = prepared.map(({ format, quantity }) => {
    const needs = new Map<string, Big>();
    const add = (id: string | null, count: Big) => {
      if (!id || count.eq(0)) return;
      if (!materials.some(material => material.id === id)) throw new Error("Packaging material not found");
      needs.set(id, (needs.get(id) ?? new Big(0)).plus(count));
      requirements.set(id, (requirements.get(id) ?? new Big(0)).plus(count));
    };
    if (!format.containerPackagingId) throw new Error("A retail pack material is required");
    add(format.containerPackagingId, new Big(quantity.totalPacks));
    add(format.cartonPackagingId, new Big(quantity.physicalCartons));
    for (const extra of extras.filter(row => row.recipeId === format.id)) add(extra.packagingMaterialId, new Big(extra.quantityPerContainer).times(normalizePackagingUsageBasis(extra.usageBasis) === "per_carton" ? quantity.physicalCartons : quantity.totalPacks));
    return needs;
  });
  // Stable material order, followed by finished stock, then individual cartons.
  for (const [id, required] of [...requirements].sort(([a], [b]) => a.localeCompare(b))) {
    const amount = packingBulk(required.toString(), "Packaging material quantity");
    const [debited] = await tx.update(materialStock).set({ quantity: sql`${materialStock.quantity} - ${amount}`, updatedAt: new Date() }).where(and(eq(materialStock.warehouseId, run.warehouseId), eq(materialStock.packagingMaterialId, id), gte(materialStock.quantity, amount))).returning({ id: materialStock.id });
    if (!debited) throw new Error(`Insufficient factory floor stock for ${materials.find(material => material.id === id)!.name}`);
  }
  await lockFinishedGoods(tx, run.warehouseId, ids);
  // Legacy jobs retain their reserved bulk and cost. Allocate the remaining
  // pool cumulatively so splitting a receipt cannot create or lose cents.
  const [legacy] = await tx.select({ bulk: sql<string>`coalesce(sum(${packagingAllocations.allocatedBulkQuantity}), 0)`, cost: sql<string>`coalesce(sum(${packagingAllocations.allocatedChemicalCost}), 0)` }).from(packagingAllocations).where(and(eq(packagingAllocations.mixingRunId, run.id), ne(packagingAllocations.status, "cancelled"), isNull(packagingAllocations.packingReceiptId)));
  const [prior] = await tx.select({ bulk: sql<string>`coalesce(sum(${batchPackingReceipts.bulkConsumed} + ${batchPackingReceipts.lossBulk}), 0)`, cost: sql<string>`coalesce(sum((${batchPackingReceipts.costAudit}->>'chemicalCost')::numeric), 0)` }).from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, run.id));
  const remainingCost = new Big(run.totalChemicalCost ?? 0).minus(legacy.cost);
  const remainingBulk = new Big(run.actualBulkProduced!).minus(legacy.bulk);
  const chemicalTotal = remainingCost.times(new Big(prior.bulk).plus(consumed).plus(lossBulk)).div(remainingBulk).round(2).minus(prior.cost);
  if (remainingCost.lt(0) || chemicalTotal.lt(0)) throw new Error("Existing packing cost reservations require reconciliation before recording packing");
  const [receipt] = await tx.insert(batchPackingReceipts).values({ mixingRunId: run.id, requestId: data.requestId, requestPayload: payload, actorId: actor.id, packedAt: data.packedAt, bulkConsumed: consumed.toFixed(3), lossBulk, lossReason: data.lossReason?.trim(), totalPacks, costAudit: { chemicalCost: chemicalTotal.toFixed(2), lossCostPolicy: "Loss chemical cost is absorbed by this receipt's outputs, apportioned by actual bulk consumed" } }).returning();
  let assignedChemical = new Big(0);
  let assignedBulk = new Big(0);
  for (const [index, item] of prepared.entries()) {
    const { line, format, quantity } = item;
    assignedBulk = assignedBulk.plus(quantity.actualBulk);
    const chemicalCost = chemicalTotal.times(assignedBulk).div(consumed).round(2).minus(assignedChemical);
    assignedChemical = assignedChemical.plus(chemicalCost);
    const materialRows = [...lineRequirements[index]].map(([id, amount]) => ({ id, amount, material: materials.find(material => material.id === id)! }));
    const packagingCost = materialRows.reduce((total, row) => total.plus(row.amount.times(row.material.costPerUnit ?? 0).round(2)), new Big(0));
    const cost = chemicalCost.plus(packagingCost);
    const perPack = cost.div(quantity.totalPacks);
    const capacity = format.containersPerCarton ?? 0;
    const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: format.id, warehouseId: run.warehouseId, operatorId: run.operatorId, initiatorId: actor.id, packingReceiptId: receipt.id, formatSnapshot: { id: format.id, name: format.name, fillAmount: format.fillAmount, fillUnit: format.fillUnit, containersPerCarton: capacity, usesCartons: !!format.cartonPackagingId }, fullCartonsRecorded: line.fullCartons, partialPacksRecorded: line.partialPacks, outsidePacksRecorded: line.loosePacks, nominalBulkRecorded: quantity.nominalBulk, varianceReason: line.varianceReason?.trim(), allocatedBulkQuantity: quantity.actualBulk, allocatedBulkUnit: run.bulkUnit, allocatedChemicalCost: chemicalCost.toFixed(2), targetContainers: quantity.totalPacks, targetCartons: line.fullCartons, targetLooseUnits: line.partialPacks + line.loosePacks, completedContainers: quantity.totalPacks, actualBulkConsumed: quantity.actualBulk, actualCartonsProduced: line.fullCartons, actualPacksProduced: quantity.totalPacks, actualLooseUnitsProduced: line.partialPacks + line.loosePacks, totalPackagingCost: packagingCost.toFixed(2), totalProductionCost: cost.toFixed(2), actualCostPerPack: perPack.toFixed(4), actualCostPerCarton: perPack.times(capacity).toFixed(4), status: "completed", startedAt: data.packedAt, completedAt: data.packedAt, closedBy: actor.id }).returning();
    for (const row of materialRows) {
      const amount = packingBulk(row.amount.toString());
      await tx.insert(packagingMaterialsUsed).values({ packagingAllocationId: allocation.id, materialId: row.id, quantityUsed: amount, costPerUnit: row.material.costPerUnit ?? "0", totalCost: row.amount.times(row.material.costPerUnit ?? 0).toFixed(2) });
      await tx.insert(inventoryAuditLog).values({ warehouseId: run.warehouseId, materialType: "packaging", materialId: row.id, type: "debit", amount, reason: `Batch packing receipt ${receipt.id}`, performedById: actor.id, referenceId: receipt.id });
    }
    const cartonRows = Array.from({ length: line.fullCartons }, () => ({ recipeId: format.id, packagingAllocationId: allocation.id, warehouseId: run.warehouseId, sku: format.name, capacity, currentPacks: capacity, status: "COMPLETE" }));
    if (line.partialPacks) cartonRows.push({ recipeId: format.id, packagingAllocationId: allocation.id, warehouseId: run.warehouseId, sku: format.name, capacity, currentPacks: line.partialPacks, status: "PARTIAL" });
    if (cartonRows.length) {
      const created = await tx.insert(cartons).values(cartonRows).returning();
      await tx.insert(adjustmentLog).values(created.map(carton => ({ cartonId: carton.id, packagingAllocationId: allocation.id, sku: format.name, type: "PRODUCTION_RECEIPT", packsBefore: 0, delta: carton.currentPacks, packsAfter: carton.currentPacks, reason: `Batch packing receipt ${receipt.id}`, performedBy: actor.id })));
    }
    const [stock] = await tx.select().from(finishedGoodsStock).where(and(eq(finishedGoodsStock.warehouseId, run.warehouseId), eq(finishedGoodsStock.recipeId, format.id))).for("update");
    const effectiveCapacity = format.cartonPackagingId ? capacity : 0;
    const units = (stock?.quantityCartons ?? 0) * effectiveCapacity + (stock?.quantityContainers ?? 0) + quantity.totalPacks;
    const value = new Big(stock?.totalInventoryValue ?? 0).plus(cost);
    const wac = value.div(units);
    const stockValues = { quantityCartons: effectiveCapacity ? Math.floor(units / effectiveCapacity) : 0, quantityContainers: effectiveCapacity ? units % effectiveCapacity : units, quantityOutsidePacks: effectiveCapacity ? (stock?.quantityOutsidePacks ?? 0) + line.loosePacks : units, weightedAverageCostPerPack: wac.toFixed(4), weightedAverageCostPerCarton: wac.times(effectiveCapacity).toFixed(4), totalInventoryValue: value.toFixed(2), updatedAt: new Date() };
    if (stock) await tx.update(finishedGoodsStock).set(stockValues).where(eq(finishedGoodsStock.id, stock.id));
    else await tx.insert(finishedGoodsStock).values({ warehouseId: run.warehouseId, recipeId: format.id, ...stockValues });
    if (line.loosePacks) await tx.insert(outsidePackMovements).values({ warehouseId: run.warehouseId, recipeId: format.id, referenceId: receipt.id, type: "PRODUCTION_RECEIPT", delta: line.loosePacks, actorId: actor.id });
    await tx.insert(wacHistory).values({ warehouseId: run.warehouseId, recipeId: format.id, packagingAllocationId: allocation.id, wacPerPack: wac.toFixed(4), wacPerCarton: wac.times(effectiveCapacity).toFixed(4), totalUnits: units, totalInventoryValue: value.toFixed(2) });
    await tx.insert(inventoryAuditLog).values({ warehouseId: run.warehouseId, materialType: "finished", materialId: format.id, type: "credit", amount: String(quantity.totalPacks), reason: `Batch packing receipt ${receipt.id}; outside packs ${line.loosePacks}`, performedById: actor.id, referenceId: receipt.id });
  }
  return { success: true as const, receiptId: receipt.id, mixingRunId: run.id };
}
