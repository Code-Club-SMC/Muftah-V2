import { createServerFn } from "@tanstack/react-start";
import { eq, and } from "drizzle-orm";
import { db, warehouses } from "@/db";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";

export const getFactoryFloorStockFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .handler(async () => {
    // Get factory floor warehouse
    const factoryFloor = await db.query.warehouses.findFirst({
      where: eq(warehouses.type, "factory_floor"),
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

    if (!factoryFloor) {
      return null;
    }

    const { cartons } = await import("@/db/schemas/manufacturing-schema");
    const { inArray, sql } = await import("drizzle-orm");

    // Hydrate factory-floor rows with carton-ledger counts so KPI cards and
    // finished-goods rows agree on the physical carton inventory.
    const cartonCounts = await db
      .select({
        recipeId: cartons.recipeId,
        total: sql<number>`count(*)::int`,
        complete: sql<number>`count(*) filter (where status in ('COMPLETE', 'SEALED'))::int`,
        partial: sql<number>`count(*) filter (where status = 'PARTIAL')::int`,
        totalPacks: sql<number>`sum(current_packs)::int`,
      })
      .from(cartons)
      .where(
        and(
          eq(cartons.warehouseId, factoryFloor.id),
          inArray(cartons.status, ["PARTIAL", "COMPLETE", "SEALED", "ON_HOLD"]),
        ),
      )
      .groupBy(cartons.recipeId);

    const statsMap = new Map();
    cartonCounts.forEach((stat) => {
      statsMap.set(stat.recipeId, stat);
    });

    return {
      ...factoryFloor,
      finishedGoodsStock: factoryFloor.finishedGoodsStock.map((fg) => {
        const stats = statsMap.get(fg.recipeId) || {
          total: 0,
          complete: 0,
          partial: 0,
          totalPacks: 0,
        };
        return {
          ...fg,
          quantityCartons: stats.total,
          cartonStats: stats,
        };
      }),
    };
  });
