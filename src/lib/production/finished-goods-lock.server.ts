import { and, eq, inArray, sql } from "drizzle-orm";
import { finishedGoodsStock } from "@/db/schemas/inventory-schema";
import type { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockFinishedGoods(tx: Tx, warehouseId: string, recipeIds: string[]) {
  const ids = [...new Set(recipeIds)].sort();
  for (const recipeId of ids) {
    // Also serialize a first receipt, when there is no stock row to lock yet.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${warehouseId}), hashtext(${recipeId}))`);
  }
  if (ids.length) {
    await tx.select({ id: finishedGoodsStock.id }).from(finishedGoodsStock)
      .where(and(eq(finishedGoodsStock.warehouseId, warehouseId), inArray(finishedGoodsStock.recipeId, ids)))
      .orderBy(finishedGoodsStock.recipeId).for("update");
  }
}
