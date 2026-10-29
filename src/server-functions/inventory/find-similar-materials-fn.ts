import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chemicals, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { isSimilarMaterialName, normalizeMaterialName } from "@/lib/inventory/material-lots";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";

// Typo guard: existing items whose name is the same or close to the typed one, with total stock.
export const findSimilarMaterialsFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(z.object({ materialType: z.enum(["chemical", "packaging"]), name: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }) => {
    const stock = sql<string>`coalesce(sum(${materialStock.quantity}), 0)`;
    const rows =
      data.materialType === "chemical"
        ? await db
            .select({ id: chemicals.id, name: chemicals.name, unit: chemicals.unit, stock })
            .from(chemicals)
            .leftJoin(materialStock, eq(materialStock.chemicalId, chemicals.id))
            .groupBy(chemicals.id, chemicals.name, chemicals.unit)
        : await db
            .select({ id: packagingMaterials.id, name: packagingMaterials.name, unit: sql<string>`'pcs'`, stock })
            .from(packagingMaterials)
            .leftJoin(materialStock, eq(materialStock.packagingMaterialId, packagingMaterials.id))
            .groupBy(packagingMaterials.id, packagingMaterials.name);
    const typed = normalizeMaterialName(data.name);
    return rows
      .filter((row) => isSimilarMaterialName(row.name, data.name))
      .slice(0, 5)
      .map((row) => ({ id: row.id, name: row.name, exact: normalizeMaterialName(row.name) === typed, stock: String(row.stock), unit: row.unit }));
  });
