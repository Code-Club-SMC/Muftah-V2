import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { chemicals, packagingMaterials, recipes } from "@/db/schemas/inventory-schema";
import { mixingMaterialsUsed, mixingRuns, formulas, packagingMaterialsUsed, packagingAllocations } from "@/db/schemas/production-schema";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";
import { packagingUnitSql } from "@/lib/inventory/material-units.server";
import { desc, count, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";

export const getConsumptionHistoryFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .inputValidator(
    z.object({
      search: z.string().optional(),
      pageIndex: z.number().int().min(0).default(0),
      pageSize: z.number().int().min(1).max(100).default(10),
    })
  )
  .handler(async ({ data }) => {
    const { search, pageIndex, pageSize } = data;
    const chemicalUsage = db.select({
      id: mixingMaterialsUsed.id, productionRunId: mixingMaterialsUsed.mixingRunId,
      materialType: sql<"chemical" | "packaging">`'chemical'`.as("material_type"),
      materialId: sql<string>`${mixingMaterialsUsed.chemicalId}`.as("material_id"),
      quantityUsed: mixingMaterialsUsed.quantityUsed, costPerUnit: mixingMaterialsUsed.costPerUnit,
      totalCost: mixingMaterialsUsed.totalCost, createdAt: mixingMaterialsUsed.createdAt,
      materialName: sql<string>`${chemicals.name}`.as("material_name"),
      materialUnit: sql<string>`${chemicals.unit}`.as("material_unit"),
      batchId: mixingRuns.batchId, productionName: sql<string>`${formulas.name}`.as("production_name"),
    }).from(mixingMaterialsUsed)
      .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
      .innerJoin(formulas, eq(mixingRuns.formulaId, formulas.id))
      .innerJoin(chemicals, eq(mixingMaterialsUsed.chemicalId, chemicals.id))
      .where(search ? ilike(mixingRuns.batchId, `%${search}%`) : undefined);
    const packagingUsage = db.select({
      id: packagingMaterialsUsed.id, productionRunId: packagingAllocations.mixingRunId,
      materialType: sql<"chemical" | "packaging">`'packaging'`.as("material_type"),
      materialId: sql<string>`${packagingMaterialsUsed.materialId}`.as("material_id"),
      quantityUsed: packagingMaterialsUsed.quantityUsed, costPerUnit: packagingMaterialsUsed.costPerUnit,
      totalCost: packagingMaterialsUsed.totalCost, createdAt: packagingMaterialsUsed.createdAt,
      materialName: sql<string>`${packagingMaterials.name}`.as("material_name"),
      materialUnit: sql<string>`${packagingUnitSql(packagingMaterials.measuredInKg)}`.as("material_unit"),
      batchId: mixingRuns.batchId, productionName: sql<string>`${recipes.name}`.as("production_name"),
    }).from(packagingMaterialsUsed)
      .innerJoin(packagingAllocations, eq(packagingMaterialsUsed.packagingAllocationId, packagingAllocations.id))
      .innerJoin(mixingRuns, eq(packagingAllocations.mixingRunId, mixingRuns.id))
      .innerJoin(recipes, eq(packagingAllocations.recipeId, recipes.id))
      .innerJoin(packagingMaterials, eq(packagingMaterialsUsed.materialId, packagingMaterials.id))
      .where(search ? ilike(mixingRuns.batchId, `%${search}%`) : undefined);
    const usage = chemicalUsage.unionAll(packagingUsage).as("usage");
    const [[{ totalCount }], history] = await Promise.all([
      db.select({ totalCount: count() }).from(usage),
      db.select().from(usage).orderBy(desc(usage.createdAt), usage.id).limit(pageSize).offset(pageIndex * pageSize),
    ]);
    return { totalCount, data: history.map(row => ({
      ...row,
      chemical: row.materialType === "chemical" ? { name: row.materialName, unit: row.materialUnit } : undefined,
      packagingMaterial: row.materialType === "packaging" ? { name: row.materialName, unit: row.materialUnit } : undefined,
      productionRun: { batchId: row.batchId, recipe: { name: row.productionName } },
    })) };
  });
