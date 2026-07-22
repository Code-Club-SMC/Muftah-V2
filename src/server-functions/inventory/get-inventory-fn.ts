import { createServerFn } from "@tanstack/react-start";
import { db, warehouses } from "@/db";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";

export const getInventoryFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .handler(async () => {
    const { cartons } = await import("@/db/schemas/manufacturing-schema");
    const { inArray, sql } = await import("drizzle-orm");

    // Fetch all warehouses and their related stocks
    const warehouseData = await db.query.warehouses.findMany({
      with: {
        materialStock: {
          with: {
            chemical: {
              with: {
                lastSupplier: true,
              },
            },
            packagingMaterial: {
              with: {
                lastSupplier: true,
              },
            },
          },
        },
        finishedGoodsStock: {
          with: {
            recipe: {
              with: {
                product: true,
              },
            },
          },
        },
      },
    });

    // Fetch accurate carton counts for all recipes across all warehouses
    // Filter out ARCHIVED and RETIRED cartons
    const cartonCounts = await db
      .select({
        warehouseId: cartons.warehouseId,
        recipeId: cartons.recipeId,
        total: sql<number>`count(*)::int`,
        complete: sql<number>`count(*) filter (where status in ('COMPLETE', 'SEALED'))::int`,
        partial: sql<number>`count(*) filter (where status = 'PARTIAL')::int`,
        totalPacks: sql<number>`sum(current_packs)::int`,
      })
      .from(cartons)
      .where(inArray(cartons.status, ["PARTIAL", "COMPLETE", "SEALED", "ON_HOLD"]))
      .groupBy(cartons.warehouseId, cartons.recipeId);

    // Create a map for efficient lookup: "warehouseId-recipeId" -> stats
    const statsMap = new Map();
    cartonCounts.forEach((stat) => {
      statsMap.set(`${stat.warehouseId}-${stat.recipeId}`, stat);
    });

    // Enrich the result with accurate counts
    return warehouseData.map((w) => ({
      ...w,
      finishedGoodsStock: w.finishedGoodsStock.map((fg) => {
        const stats = statsMap.get(`${w.id}-${fg.recipeId}`) || {
          total: 0,
          complete: 0,
          partial: 0,
          totalPacks: 0,
        };
        return {
          ...fg,
          quantityCartons: stats.total, // Replace stale aggregate with accurate total
          cartonStats: stats, // Provide rich breakdown
        };
      }),
    }));
  });
