import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  chemicals,
  db,
  finishedGoodsStock,
  materialStock,
  packagingMaterials,
  warehouses,
} from "@/db";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";

const ACTIVE_CARTON_STATUSES = ["PARTIAL", "COMPLETE", "SEALED", "ON_HOLD"] as const;

export const getLowStockAlertsFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .handler(async () => {
    const factoryFloor = await db.query.warehouses.findFirst({
      where: eq(warehouses.type, "factory_floor"),
    });

    if (!factoryFloor) {
      return [];
    }

    const rawAlerts = await db
      .select({
        id: materialStock.id,
        warehouseId: materialStock.warehouseId,
        warehouseName: warehouses.name,
        materialId: chemicals.id,
        materialName: chemicals.name,
        materialType: sql<string>`'raw'`,
        currentStock: materialStock.quantity,
        minLevel: chemicals.minimumStockLevel,
        unit: chemicals.unit,
      })
      .from(materialStock)
      .innerJoin(chemicals, eq(materialStock.chemicalId, chemicals.id))
      .innerJoin(warehouses, eq(materialStock.warehouseId, warehouses.id))
      .where(
        and(
          eq(materialStock.warehouseId, factoryFloor.id),
          sql`${chemicals.minimumStockLevel}::numeric > 0`,
          lte(materialStock.quantity, chemicals.minimumStockLevel),
        ),
      );

    const packagingAlerts = await db
      .select({
        id: materialStock.id,
        warehouseId: materialStock.warehouseId,
        warehouseName: warehouses.name,
        materialId: packagingMaterials.id,
        materialName: packagingMaterials.name,
        materialType: sql<string>`'packaging'`,
        currentStock: materialStock.quantity,
        minLevel: sql<string>`${packagingMaterials.minimumStockLevel}::text`,
        unit: packagingMaterials.capacityUnit,
      })
      .from(materialStock)
      .innerJoin(
        packagingMaterials,
        eq(materialStock.packagingMaterialId, packagingMaterials.id),
      )
      .innerJoin(warehouses, eq(materialStock.warehouseId, warehouses.id))
      .where(
        and(
          eq(materialStock.warehouseId, factoryFloor.id),
          sql`${packagingMaterials.minimumStockLevel}::numeric > 0`,
          lte(materialStock.quantity, packagingMaterials.minimumStockLevel),
        ),
      );

    const finishedGoodsRows = await db.query.finishedGoodsStock.findMany({
      where: eq(finishedGoodsStock.warehouseId, factoryFloor.id),
      with: {
        recipe: true,
      },
    });

    const { cartons } = await import("@/db/schemas/manufacturing-schema");

    const cartonCounts = await db
      .select({
        recipeId: cartons.recipeId,
        totalPacks: sql<number>`coalesce(sum(${cartons.currentPacks}), 0)::int`,
      })
      .from(cartons)
      .where(
        and(
          eq(cartons.warehouseId, factoryFloor.id),
          inArray(cartons.status, [...ACTIVE_CARTON_STATUSES]),
        ),
      )
      .groupBy(cartons.recipeId);

    const totalPacksByRecipe = new Map(
      cartonCounts.map((row) => [row.recipeId, Number(row.totalPacks ?? 0)]),
    );

    const finishedGoodsAlerts = finishedGoodsRows
      .filter((row) => (row.recipe.minimumStockLevel ?? 0) > 0)
      .map((row) => {
        const totalUnits =
          (totalPacksByRecipe.get(row.recipeId) ?? 0) + row.quantityContainers;

        return {
          id: row.id,
          warehouseId: row.warehouseId,
          warehouseName: factoryFloor.name,
          materialId: row.recipe.id,
          materialName: row.recipe.name,
          materialType: "finished",
          currentStock: totalUnits.toString(),
          minLevel: String(row.recipe.minimumStockLevel ?? 0),
          unit: "Units",
        };
      })
      .filter(
        (row) => Number(row.currentStock) <= Number(row.minLevel),
      );

    return [...rawAlerts, ...packagingAlerts, ...finishedGoodsAlerts];
  });
