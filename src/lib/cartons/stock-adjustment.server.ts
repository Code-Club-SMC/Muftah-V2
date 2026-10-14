import Big from "big.js";
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
  finishedGoodsStock,
  inventoryAuditLog,
  recipes,
} from "@/db/schemas/inventory-schema";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StockRef = { warehouseId: string; recipeId: string };

// Always acquire stock locks before carton locks, as invoice posting does.
export async function lockCartonStock(tx: Tx, refs: StockRef[]) {
  const byWarehouse = new Map<string, string[]>();
  for (const ref of refs) {
    byWarehouse.set(ref.warehouseId, [
      ...(byWarehouse.get(ref.warehouseId) ?? []),
      ref.recipeId,
    ]);
  }
  for (const [warehouseId, recipeIds] of [...byWarehouse].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    await lockFinishedGoods(tx, warehouseId, recipeIds);
  }
}

export async function adjustCartonStock(
  tx: Tx,
  ref: StockRef,
  delta: number,
  userId: string,
  referenceId: string,
  inboundCost?: number,
  inboundValue?: string,
  auditReason = "Carton stock adjustment",
) {
  if (!delta) return "0.00";
  const stock = await tx.query.finishedGoodsStock.findFirst({
    where: and(
      eq(finishedGoodsStock.warehouseId, ref.warehouseId),
      eq(finishedGoodsStock.recipeId, ref.recipeId),
    ),
  });
  if (!stock)
    throw new Error(
      "Finished goods stock must exist before adjusting received cartons",
    );
  const recipe = await tx.query.recipes.findFirst({
    where: eq(recipes.id, ref.recipeId),
  });
  if (!recipe) throw new Error("Carton recipe not found");
  const capacity = recipe.cartonPackagingId
    ? (recipe.containersPerCarton ?? 0)
    : 0;
  const oldUnits = stock.quantityCartons * capacity + stock.quantityContainers;
  const units = oldUnits + delta;
  if (units < 0)
    throw new Error("Carton adjustment exceeds finished goods stock");
  const unitCost =
    delta > 0 && inboundCost !== undefined
      ? inboundCost
      : Number(stock.weightedAverageCostPerPack ?? 0);
  const oldValue = new Big(stock.totalInventoryValue ?? 0);
  // Recorded cents are authoritative; rounded per-pack WAC cannot reconstruct
  // the value of a batch. Keep rounding residuals until the final unit leaves.
  const movement =
    delta < 0
      ? units === 0
        ? oldValue
        : new Big(oldValue.times(-delta).div(oldUnits).toFixed(2))
      : new Big(inboundValue ?? new Big(delta).times(unitCost).toFixed(2));
  const value = delta < 0 ? oldValue.minus(movement) : oldValue.plus(movement);
  if (value.lt(0))
    throw new Error("Carton adjustment would make inventory value negative");
  const wac =
    units > 0
      ? value.div(units)
      : new Big(stock.weightedAverageCostPerPack ?? 0);
  await tx
    .update(finishedGoodsStock)
    .set({
      quantityCartons: capacity > 0 ? Math.floor(units / capacity) : 0,
      quantityContainers: capacity > 0 ? units % capacity : units,
      ...(!capacity ? { quantityOutsidePacks: units } : {}),
      totalInventoryValue: value.toFixed(2),
      weightedAverageCostPerPack: wac.toFixed(4),
      weightedAverageCostPerCarton:
        capacity > 0 ? wac.times(capacity).toFixed(4) : "0",
      updatedAt: new Date(),
    })
    .where(eq(finishedGoodsStock.id, stock.id));
  await tx
    .insert(inventoryAuditLog)
    .values({
      warehouseId: ref.warehouseId,
      materialType: "finished",
      materialId: ref.recipeId,
      type: delta > 0 ? "credit" : "debit",
      amount: String(Math.abs(delta)),
      reason: auditReason,
      referenceId,
      performedById: userId,
    });
  return movement.toFixed(2);
}
