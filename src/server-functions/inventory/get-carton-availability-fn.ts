import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { cartons } from "@/db/schemas/manufacturing-schema";
import { finishedGoodsStock, recipes } from "@/db/schemas/inventory-schema";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { eq, and, sql, inArray } from "drizzle-orm";

/**
 * Returns complete vs partial carton counts grouped by recipeId
 * for a given warehouse. Used by the invoice product dropdown to
 * show standard full COMPLETE/SEALED cartons and eligible loose packs.
 * Partial and nonstandard full cartons contribute packs for unit sales.
 */
export const getCartonAvailabilityFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ warehouseId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const standardFullCarton = sql`${cartons.status} IN ('COMPLETE', 'SEALED')
      AND ${recipes.cartonPackagingId} IS NOT NULL AND ${recipes.containersPerCarton} > 0
      AND ${cartons.capacity} = ${recipes.containersPerCarton}
      AND ${cartons.currentPacks} = ${recipes.containersPerCarton}`;

    const rows = await db
      .select({
        recipeId: cartons.recipeId,
        completeCartons: sql<number>`COALESCE(SUM(CASE WHEN ${standardFullCarton} THEN 1 ELSE 0 END), 0)`.as("complete_cartons"),
        partialCartons: sql<number>`COALESCE(SUM(CASE WHEN ${standardFullCarton} THEN 0 ELSE 1 END), 0)`.as("partial_cartons"),
        totalPacks: sql<number>`COALESCE(SUM(${cartons.currentPacks}), 0)`.as("total_packs"),
      })
      .from(cartons)
      .innerJoin(recipes, eq(cartons.recipeId, recipes.id))
      .where(
        and(
          eq(cartons.warehouseId, data.warehouseId),
          inArray(cartons.status, ["COMPLETE", "SEALED", "PARTIAL"]),
        ),
      )
      .groupBy(cartons.recipeId);

    const stocks = await db.select({
      recipeId: finishedGoodsStock.recipeId,
      quantityOutsidePacks: sql<number>`CASE
        WHEN ${recipes.cartonPackagingId} IS NOT NULL AND ${recipes.containersPerCarton} > 0
        THEN ${finishedGoodsStock.quantityOutsidePacks}
        ELSE ${finishedGoodsStock.quantityContainers} END`,
    }).from(finishedGoodsStock).innerJoin(recipes, eq(finishedGoodsStock.recipeId, recipes.id))
      .where(eq(finishedGoodsStock.warehouseId, data.warehouseId));
    const byRecipe = new Map(rows.map(row => [row.recipeId, row]));
    for (const stock of stocks) if (stock.quantityOutsidePacks > 0 && !byRecipe.has(stock.recipeId)) byRecipe.set(stock.recipeId, { recipeId: stock.recipeId, completeCartons: 0, partialCartons: 0, totalPacks: 0 });
    return [...byRecipe.values()].map((r) => ({
      recipeId: r.recipeId,
      completeCartons: Number(r.completeCartons),
      partialCartons: Number(r.partialCartons),
      totalPacks: Number(r.totalPacks) + (stocks.find(stock => stock.recipeId === r.recipeId)?.quantityOutsidePacks ?? 0),
      outsidePacks: stocks.find(stock => stock.recipeId === r.recipeId)?.quantityOutsidePacks ?? 0,
    }));
  });
