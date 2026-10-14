import { eq } from "drizzle-orm";
import { z } from "zod";
import type { db } from "@/db";
import { finishedGoodsStock, recipes, wacHistory } from "@/db/schemas/inventory-schema";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";
import { adjustCartonStock } from "@/lib/cartons/stock-adjustment.server";
import { moveOutsidePacks } from "@/lib/cartons/outside-packs.server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const count = z.number().int().nonnegative().max(2147483647);
export const updateOutsidePackStockSchema = z.object({
  stockId: z.string().min(1),
  adjustmentType: z.enum(["set", "add", "subtract"]),
  quantity: count,
  expectedCurrent: count,
  reason: z.string().trim().min(1, "Give a reason for this correction").max(2000),
});

export async function updateOutsidePackStockCore(tx: Tx, input: z.infer<typeof updateOutsidePackStockSchema>, actorId: string) {
  const data = updateOutsidePackStockSchema.parse(input);
  const [ref] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.id, data.stockId));
  if (!ref) throw new Error("Stock not found");
  await lockFinishedGoods(tx, ref.warehouseId, [ref.recipeId]);
  const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.id, data.stockId));
  if (!stock) throw new Error("Stock not found");
  const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, stock.recipeId));
  if (!recipe) throw new Error("Packaging format not found");
  const capacity = recipe.cartonPackagingId ? recipe.containersPerCarton ?? 0 : 0;
  const current = capacity ? stock.quantityOutsidePacks : stock.quantityContainers;
  if (current !== data.expectedCurrent) throw new Error("Stock changed. Refresh the current balance before correcting it");
  const quantity = data.adjustmentType === "set" ? data.quantity : current + (data.adjustmentType === "add" ? data.quantity : -data.quantity);
  if (quantity < 0) throw new Error("Insufficient outside packs");
  const delta = quantity - current;
  const units = stock.quantityCartons * capacity + stock.quantityContainers + delta;
  if (units < 0 || units > 2147483647) throw new Error("Corrected pack count exceeds the supported limit");
  await moveOutsidePacks(tx, { warehouseId: stock.warehouseId, recipeId: stock.recipeId, delta, referenceId: stock.id, type: "STOCK_CORRECTION", userId: actorId });
  await adjustCartonStock(tx, { warehouseId: stock.warehouseId, recipeId: stock.recipeId }, delta, actorId, stock.id, undefined, undefined, `Outside pack correction: ${data.reason}`);
  const [updated] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.id, stock.id));
  if (delta) await tx.insert(wacHistory).values({ warehouseId: stock.warehouseId, recipeId: stock.recipeId, totalUnits: units, totalInventoryValue: updated.totalInventoryValue, wacPerPack: updated.weightedAverageCostPerPack ?? "0", wacPerCarton: updated.weightedAverageCostPerCarton ?? "0" });
  return { success: true as const, stockId: stock.id, quantityOutsidePacks: quantity };
}
