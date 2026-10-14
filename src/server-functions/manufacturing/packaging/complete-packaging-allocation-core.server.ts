import { and, eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { cartons, adjustmentLog } from "@/db/schemas/manufacturing-schema";
import { packagingAllocations } from "@/db/schemas/production-schema";
import { finishedGoodsStock, inventoryAuditLog, recipes, wacHistory } from "@/db/schemas/inventory-schema";
import { calculateActualRunCost, calculateTotalUnits } from "@/lib/wac";
import type { db } from "@/db";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";

type ProductionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function completePackagingAllocationCore(tx: ProductionTx, allocationId: string, userId: string, shortfallReason?: string) {
  const [allocation] = await tx.select().from(packagingAllocations)
    .where(eq(packagingAllocations.id, allocationId)).for("update");
  if (!allocation) throw new Error("Packing Job not found");
  if (allocation.status !== "in_progress") throw new Error("Packing Job must be in progress to complete");

  const totalContainersProduced = Number(allocation.completedContainers ?? 0);
  const shortfallUnits = Number(allocation.targetContainers) - totalContainersProduced;
  if (shortfallUnits < 0) throw new Error("Packaging output exceeds the packing job target");
  if (shortfallUnits > 0 && !shortfallReason?.trim()) throw new Error("A shortfall reason is required below target");
  if (totalContainersProduced <= 0) throw new Error("No packaged units have been recorded");

  const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, allocation.recipeId));
  if (!recipe) throw new Error("Packaging Format not found");
  const perCarton = recipe.containersPerCarton ?? 0;
  const usesCartons = perCarton > 0 && !!recipe.cartonPackagingId;
  const finalCartons = usesCartons ? Math.floor(totalContainersProduced / perCarton) : 0;
  const finalLoose = usesCartons ? totalContainersProduced % perCarton : totalContainersProduced;
  const totalProductionCost = new Big(allocation.allocatedChemicalCost ?? 0).plus(allocation.totalPackagingCost ?? 0);
  const cost = calculateActualRunCost(totalProductionCost.toNumber(), totalContainersProduced, finalCartons, finalLoose, allocation.targetCartons ?? 0);

  // Serialize receipts even when the finished-goods row does not exist yet.
  await lockFinishedGoods(tx, allocation.warehouseId, [recipe.id]);
  const [stock] = await tx.select().from(finishedGoodsStock)
    .where(and(eq(finishedGoodsStock.warehouseId, allocation.warehouseId), eq(finishedGoodsStock.recipeId, recipe.id)))
    .for("update");
  const existingUnits = stock ? calculateTotalUnits(stock.quantityCartons, stock.quantityContainers, perCarton) : 0;
  const newUnits = existingUnits + totalContainersProduced;
  const newValue = new Big(stock?.totalInventoryValue ?? 0).plus(totalProductionCost);
  const newWAC = newValue.div(newUnits);
  const wacPerCarton = newWAC.times(perCarton > 0 ? perCarton : 0);
  const stockValues = {
    weightedAverageCostPerPack: newWAC.toFixed(4),
    weightedAverageCostPerCarton: wacPerCarton.toFixed(4),
    totalInventoryValue: newValue.toFixed(2),
    updatedAt: new Date(),
  };
  if (stock) {
    await tx.update(finishedGoodsStock).set({
      ...stockValues,
      quantityCartons: sql`${finishedGoodsStock.quantityCartons} + ${finalCartons}`,
      quantityContainers: sql`${finishedGoodsStock.quantityContainers} + ${finalLoose}`,
    }).where(eq(finishedGoodsStock.id, stock.id));
  } else {
    await tx.insert(finishedGoodsStock).values({
      warehouseId: allocation.warehouseId,
      recipeId: recipe.id,
      quantityCartons: finalCartons,
      quantityContainers: finalLoose,
      ...stockValues,
    });
  }
  await tx.insert(wacHistory).values({
    recipeId: recipe.id,
    warehouseId: allocation.warehouseId,
    wacPerPack: newWAC.toFixed(4),
    wacPerCarton: wacPerCarton.toFixed(4),
    totalUnits: newUnits,
    totalInventoryValue: newValue.toFixed(2),
    packagingAllocationId: allocation.id,
  });

  if (usesCartons) {
    const cartonRows: Array<typeof cartons.$inferInsert> = Array.from({ length: finalCartons }, () => ({
      id: createId(), recipeId: recipe.id, packagingAllocationId: allocation.id,
      warehouseId: allocation.warehouseId, sku: recipe.name,
      capacity: perCarton, currentPacks: perCarton, status: "COMPLETE",
    }));
    if (finalLoose > 0) cartonRows.push({
      id: createId(), recipeId: recipe.id, packagingAllocationId: allocation.id,
      warehouseId: allocation.warehouseId, sku: recipe.name,
      capacity: perCarton, currentPacks: finalLoose, status: "PARTIAL",
    });
    if (cartonRows.length) {
      const createdCartons = await tx.insert(cartons).values(cartonRows).returning();
      await tx.insert(adjustmentLog).values(createdCartons.map(carton => ({
        cartonId: carton.id,
        packagingAllocationId: allocation.id,
        sku: carton.sku,
        type: "PRODUCTION_RECEIPT",
        packsBefore: 0,
        delta: carton.currentPacks,
        packsAfter: carton.currentPacks,
        reason: "Packing job completed",
        performedBy: userId,
      })));
    }
  }
  await tx.insert(inventoryAuditLog).values({
    warehouseId: allocation.warehouseId, materialType: "finished", materialId: recipe.id,
    type: "credit", amount: totalContainersProduced.toString(),
    reason: `Packing job ${allocation.id} completed`, performedById: userId, referenceId: allocation.id,
  });

  const [updated] = await tx.update(packagingAllocations).set({
    status: "completed", completedAt: new Date(), actualCartonsProduced: finalCartons,
    actualPacksProduced: totalContainersProduced, actualLooseUnitsProduced: finalLoose,
    totalProductionCost: totalProductionCost.toFixed(2),
    actualCostPerPack: cost.actualCostPerPack.toFixed(4),
    actualCostPerCarton: (usesCartons ? cost.actualCostPerPack * perCarton : 0).toFixed(4),
    shortfallUnits, shortfallReason: shortfallUnits > 0 ? shortfallReason!.trim() : null,
    yieldVarianceCartons: cost.yieldVarianceCartons, closedBy: userId, updatedAt: new Date(),
  }).where(eq(packagingAllocations.id, allocation.id)).returning();
  return { success: true, allocation: updated, mixingRunId: updated.mixingRunId };
}
