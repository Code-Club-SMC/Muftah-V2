import { createServerFn } from "@tanstack/react-start";
import { eq, and, gt, desc } from "drizzle-orm";
import Big from "big.js";
import { db, warehouses } from "@/db";
import { mixingRuns } from "@/db/schemas/production-schema";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";

export const getFactoryFloorStockFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .handler(async () => {
    // Get factory floor warehouse
    const factoryFloor = await db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.type, "factory_floor"),
        eq(warehouses.isActive, true),
      ),
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

    const batches = await db.query.mixingRuns.findMany({
      columns: {
        id: true,
        batchId: true,
        actualBulkProduced: true,
        bulkUnit: true,
      },
      where: and(
        eq(mixingRuns.warehouseId, factoryFloor.id),
        eq(mixingRuns.status, "completed"),
        gt(mixingRuns.actualBulkProduced, "0"),
      ),
      with: {
        formula: { columns: { name: true } },
        packingReceipts: { columns: { lossBulk: true } },
        packagingAllocations: {
          columns: { status: true, allocatedBulkQuantity: true },
        },
      },
      orderBy: [desc(mixingRuns.actualCompletionDate), desc(mixingRuns.id)],
    });
    const mixedBulk = batches.flatMap((batch) => {
      // Match the reservation rule used when creating a packing job.
      const reserved = batch.packagingAllocations
        .filter((allocation) => allocation.status !== "cancelled")
        .reduce(
          (sum, allocation) => sum.plus(allocation.allocatedBulkQuantity),
          new Big(0),
        );
      const loss = (batch.packingReceipts ?? []).reduce((total, receipt) => total.plus(receipt.lossBulk), new Big(0));
      const remaining = new Big(batch.actualBulkProduced ?? 0).minus(reserved).minus(loss);
      const available = remaining.gt(0) ? remaining : new Big(0);
      const hasPendingPacking = batch.packagingAllocations.some(
        (allocation) =>
          allocation.status === "allocated" ||
          allocation.status === "in_progress",
      );
      if (available.eq(0) && !hasPendingPacking) return [];
      return [
        {
          id: batch.id,
          batchId: batch.batchId,
          formulaName: batch.formula.name,
          bulkUnit: batch.bulkUnit,
          producedQuantity: new Big(batch.actualBulkProduced ?? 0).toString(),
          reservedQuantity: reserved.toString(),
          availableQuantity: available.toString(),
        },
      ];
    });

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
      mixedBulk,
      finishedGoodsStock: factoryFloor.finishedGoodsStock.map((fg) => {
        const stats = statsMap.get(fg.recipeId) || {
          total: 0,
          complete: 0,
          partial: 0,
          totalPacks: 0,
        };
        return {
          ...fg,
          cartonStats: { ...stats, totalPacks: stats.totalPacks + (fg.quantityOutsidePacks ?? 0), outsidePacks: fg.quantityOutsidePacks },
        };
      }),
    };
  });
