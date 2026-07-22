import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db, materialStock, packagingMaterials, chemicals } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deleteMaterialSchema = z.object({
  id: z.string(),
  type: z.enum(["chemical", "packaging"]),
});

export const deleteMaterialFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(deleteMaterialSchema)
  .handler(async ({ data }) => {
    try {
      if (data.type === "chemical") {
        // Delete from materialStock first
        await db
          .delete(materialStock)
          .where(eq(materialStock.chemicalId, data.id));
        // Delete material
        await db.delete(chemicals).where(eq(chemicals.id, data.id));
      } else {
        // Delete from materialStock first
        await db
          .delete(materialStock)
          .where(eq(materialStock.packagingMaterialId, data.id));
        // Delete material
        await db
          .delete(packagingMaterials)
          .where(eq(packagingMaterials.id, data.id));
      }
      return { success: true };
    } catch (error) {
      console.error("Delete Error:", error);
      throw new Error(
        "Failed to delete material. It might be in use by recipes or production runs.",
      );
    }
  });
