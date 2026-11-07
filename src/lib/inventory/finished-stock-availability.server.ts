import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { finishedGoodsStock, recipes } from "@/db/schemas/inventory-schema";
import { cartons } from "@/db/schemas/manufacturing-schema";

// Read the same usable statuses as invoice dispatch. Never substitute nominal carton capacity.
export async function finishedAvailableUnits(
  warehouseId: string,
): Promise<Map<string, number>> {
  const usable = db
    .select({
      recipeId: cartons.recipeId,
      packs: sql<string>`sum(${cartons.currentPacks})::text`.as("packs"),
    })
    .from(cartons)
    .where(
      and(
        eq(cartons.warehouseId, warehouseId),
        inArray(cartons.status, ["COMPLETE", "SEALED", "PARTIAL"]),
      ),
    )
    .groupBy(cartons.recipeId)
    .as("usable_carton_packs");
  const rows = await db
    .select({
      recipeId: recipes.id,
      quantity: sql<string>`case when ${recipes.cartonPackagingId} is not null and ${recipes.containersPerCarton} > 0
      then coalesce(${usable.packs}, '0')::numeric + coalesce(${finishedGoodsStock.quantityOutsidePacks}, 0)
      else coalesce(${finishedGoodsStock.quantityContainers}, 0) end::text`,
    })
    .from(recipes)
    .leftJoin(
      finishedGoodsStock,
      and(
        eq(finishedGoodsStock.recipeId, recipes.id),
        eq(finishedGoodsStock.warehouseId, warehouseId),
      ),
    )
    .leftJoin(usable, eq(usable.recipeId, recipes.id))
    .where(eq(recipes.isActive, true));
  return new Map(rows.map((row) => [row.recipeId, Number(row.quantity)]));
}
