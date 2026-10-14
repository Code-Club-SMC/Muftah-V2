import { createServerFn } from "@tanstack/react-start";
import { and, eq, lte, sql } from "drizzle-orm";
import {
  chemicals,
  db,
  finishedGoodsStock,
  materialStock,
  packagingMaterials,
  warehouses,
} from "@/db";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";
import { calculateTotalUnits } from "@/lib/wac";

export const getLowStockAlertsFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .handler(async () => {
    const factoryFloor = await db.query.warehouses.findFirst({
      where: and(eq(warehouses.type, "factory_floor"), eq(warehouses.isActive, true)),
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

    const finishedGoodsAlerts = finishedGoodsRows
      .filter((row) => (row.recipe.minimumStockLevel ?? 0) > 0)
      .map((row) => {
        const totalUnits =
          calculateTotalUnits(row.quantityCartons, row.quantityContainers, row.recipe.containersPerCarton ?? 0);

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
