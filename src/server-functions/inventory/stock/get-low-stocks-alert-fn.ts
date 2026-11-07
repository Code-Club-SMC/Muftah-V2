import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chemicals,
  materialStock,
  packagingMaterials,
  recipes,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";
import { packagingUnitSql } from "@/lib/inventory/material-units.server";
import { stockStatus } from "@/lib/inventory/stock-status";
import { finishedAvailableUnits } from "@/lib/inventory/finished-stock-availability.server";

export const getLowStockAlertsFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .handler(async () => {
    const floor = await db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.type, "factory_floor"),
        eq(warehouses.isActive, true),
      ),
      orderBy: [asc(warehouses.createdAt), asc(warehouses.id)],
    });
    if (!floor) return [];

    const [raw, packaging, formats, available] = await Promise.all([
      db
        .select({
          materialId: chemicals.id,
          materialName: chemicals.name,
          currentStock: sql<string>`coalesce(${materialStock.quantity}, 0)::text`,
          minLevel: chemicals.minimumStockLevel,
          unit: chemicals.unit,
        })
        .from(chemicals)
        .leftJoin(
          materialStock,
          and(
            eq(materialStock.chemicalId, chemicals.id),
            eq(materialStock.warehouseId, floor.id),
          ),
        ),
      db
        .select({
          materialId: packagingMaterials.id,
          materialName: packagingMaterials.name,
          currentStock: sql<string>`coalesce(${materialStock.quantity}, 0)::text`,
          minLevel: sql<string>`${packagingMaterials.minimumStockLevel}::text`,
          unit: packagingUnitSql(packagingMaterials.measuredInKg),
        })
        .from(packagingMaterials)
        .leftJoin(
          materialStock,
          and(
            eq(materialStock.packagingMaterialId, packagingMaterials.id),
            eq(materialStock.warehouseId, floor.id),
          ),
        ),
      db
        .select({
          id: recipes.id,
          name: recipes.name,
          minimumStockLevel: recipes.minimumStockLevel,
        })
        .from(recipes)
        .where(eq(recipes.isActive, true)),
      finishedAvailableUnits(floor.id),
    ]);
    const rows = [
      ...raw.map((row) => ({ ...row, materialType: "raw" as const })),
      ...packaging.map((row) => ({
        ...row,
        materialType: "packaging" as const,
      })),
      ...formats.map((row) => ({
        materialId: row.id,
        materialName: row.name,
        materialType: "finished" as const,
        currentStock: String(available.get(row.id) ?? 0),
        minLevel: String(row.minimumStockLevel ?? 0),
        unit: "Units",
      })),
    ];
    return rows
      .flatMap((row) => {
        const status = stockStatus(row.currentStock, row.minLevel);
        return status === "healthy"
          ? []
          : [
              {
                ...row,
                status,
                id: `${floor.id}:${row.materialType}:${row.materialId}`,
                warehouseId: floor.id,
                warehouseName: floor.name,
              },
            ];
      })
      .sort(
        (a, b) =>
          (a.status === "out" ? 0 : 1) - (b.status === "out" ? 0 : 1) ||
          a.materialName.localeCompare(b.materialName) ||
          a.materialType.localeCompare(b.materialType) ||
          a.id.localeCompare(b.id),
      );
  });
