import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { finishedGoodsStock, recipes } from "@/db/schemas/inventory-schema";
import { outsidePackMovements } from "@/db/schemas/production-schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function moveOutsidePacks(tx: Tx, input: {
  warehouseId: string; recipeId: string; delta: number; referenceId: string; type: string; userId: string;
}) {
  if (!input.delta) return;
  // Formats without cartons store all units outside, including legacy stock
  // whose outside balance predates the explicit ledger.
  const recipe = await tx.query.recipes.findFirst({ where: eq(recipes.id, input.recipeId) });
  const balance = recipe?.cartonPackagingId && recipe.containersPerCarton
    ? finishedGoodsStock.quantityOutsidePacks : finishedGoodsStock.quantityContainers;
  const [updated] = await tx.update(finishedGoodsStock).set({ quantityOutsidePacks: sql`${balance} + ${input.delta}` }).where(and(eq(finishedGoodsStock.warehouseId, input.warehouseId), eq(finishedGoodsStock.recipeId, input.recipeId), input.delta < 0 ? gte(balance, -input.delta) : undefined)).returning({ id: finishedGoodsStock.id });
  if (!updated) throw new Error("Insufficient outside packs");
  await tx.insert(outsidePackMovements).values({ warehouseId: input.warehouseId, recipeId: input.recipeId, delta: input.delta, referenceId: input.referenceId, type: input.type, actorId: input.userId });
}
export async function outstandingOutsideDispatch(tx: Tx, invoiceId: string, recipeId: string, includeReturns = false) {
  const [row] = await tx.select({ units: sql<string>`-coalesce(sum(${outsidePackMovements.delta}), 0)` }).from(outsidePackMovements).where(and(eq(outsidePackMovements.referenceId, invoiceId), eq(outsidePackMovements.recipeId, recipeId), inArray(outsidePackMovements.type, includeReturns ? ["DISPATCH", "INVOICE_REVERSAL", "RETURN_GOOD", "RETURN_DAMAGED"] : ["DISPATCH", "INVOICE_REVERSAL"])));
  return Number(row.units);
}
