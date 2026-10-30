import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db, packagingMaterials, chemicals } from "@/db";
import { deleteItemLots } from "@/lib/inventory/material-lots.server";
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
      await db.transaction(async (tx) => {
        // Lots, lot stock and stock rows go first
        await deleteItemLots(tx, { materialType: data.type, materialId: data.id });
        if (data.type === "chemical") {
          await tx.delete(chemicals).where(eq(chemicals.id, data.id));
        } else {
          await tx
            .delete(packagingMaterials)
            .where(eq(packagingMaterials.id, data.id));
        }
      });
      return { success: true };
    } catch (error) {
      console.error("Delete Error:", error);
      if (error instanceof Error && error.message.includes("stock history")) throw error;
      throw new Error(
        "Failed to delete material. It might be in use by recipes or production runs.",
      );
    }
  });
