import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db, materialStock, packagingMaterials, chemicals } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const updateMaterialSchema = z.object({
  id: z.string(),
  stockId: z.string().optional(),
  type: z.enum(["chemical", "packaging"]),
  data: z.object({
    name: z.string().min(1),
    unit: z.string().optional(),
    costPerUnit: z.string().min(1),
    minimumStockLevel: z.union([z.string(), z.number()]),
    quantity: z.string().optional(),
    materialType: z.string().optional(), // Maps to 'type' in packaging_materials
    capacity: z.string().optional(),
    capacityUnit: z.string().optional(),
  }),
});

export const updateMaterialFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateMaterialSchema)
  .handler(async ({ data }) => {
    try {
      const { id, type, stockId, data: fields } = data;

      return await db.transaction(async (tx) => {
        if (type === "chemical") {
          await tx
            .update(chemicals)
            .set({
              name: fields.name,
              unit: fields.unit,
              costPerUnit: fields.costPerUnit,
              minimumStockLevel: fields.minimumStockLevel.toString(),
            })
            .where(eq(chemicals.id, id));
        } else {
          await tx
            .update(packagingMaterials)
            .set({
              name: fields.name,
              costPerUnit: fields.costPerUnit,
              minimumStockLevel: Number(fields.minimumStockLevel),
              type: fields.materialType,
              capacity: fields.capacity || null,
              capacityUnit: fields.capacityUnit || null,
            })
            .where(eq(packagingMaterials.id, id));
        }

        if (stockId && fields.quantity !== undefined) {
          await tx
            .update(materialStock)
            .set({ quantity: fields.quantity.toString() })
            .where(eq(materialStock.id, stockId));
        }

        return { success: true };
      });
    } catch (error) {
      console.error("Update Error:", error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to update material.",
      );
    }
  });
