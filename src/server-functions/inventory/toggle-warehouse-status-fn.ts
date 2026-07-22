import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db, finishedGoodsStock, materialStock, warehouses } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const toggleWarehouseStatusSchema = z.object({
  warehouseId: z.string().min(1),
  isActive: z.boolean(),
  transferToWarehouseId: z.string().optional(),
});

export const toggleWarehouseStatusFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(toggleWarehouseStatusSchema)
  .handler(
    async ({ data: { warehouseId, isActive, transferToWarehouseId } }) => {
      try {
        await db.transaction(async (tx) => {
          // If Deactivating AND Transfer requested
          if (!isActive && transferToWarehouseId) {
            // --- Transfer Material Stock ---
            const sourceMaterials = await tx.query.materialStock.findMany({
              where: eq(materialStock.warehouseId, warehouseId),
            });
            const targetMaterials = await tx.query.materialStock.findMany({
              where: eq(materialStock.warehouseId, transferToWarehouseId),
            });

            for (const sourceItem of sourceMaterials) {
              // Find matching item in target warehouse
              const targetItem = targetMaterials.find((t) => {
                if (sourceItem.chemicalId) {
                  return t.chemicalId === sourceItem.chemicalId;
                }
                if (sourceItem.packagingMaterialId) {
                  return (
                    t.packagingMaterialId === sourceItem.packagingMaterialId
                  );
                }
                return false;
              });

              if (targetItem) {
                // Update target quantity and delete source
                const newQuantity =
                  Number(targetItem.quantity) + Number(sourceItem.quantity);

                await tx
                  .update(materialStock)
                  .set({ quantity: newQuantity.toString() })
                  .where(eq(materialStock.id, targetItem.id));

                await tx
                  .delete(materialStock)
                  .where(eq(materialStock.id, sourceItem.id));
              } else {
                // Move source item to target warehouse
                await tx
                  .update(materialStock)
                  .set({ warehouseId: transferToWarehouseId })
                  .where(eq(materialStock.id, sourceItem.id));
              }
            }

            // --- Transfer Finished Goods Stock ---
            const sourceFG = await tx.query.finishedGoodsStock.findMany({
              where: eq(finishedGoodsStock.warehouseId, warehouseId),
            });
            const targetFG = await tx.query.finishedGoodsStock.findMany({
              where: eq(finishedGoodsStock.warehouseId, transferToWarehouseId),
            });

            for (const sourceItem of sourceFG) {
              const targetItem = targetFG.find(
                (t) => t.recipeId === sourceItem.recipeId,
              );

              if (targetItem) {
                // Update target quantities
                const newCartons =
                  (targetItem.quantityCartons || 0) +
                  (sourceItem.quantityCartons || 0);
                const newContainers =
                  (targetItem.quantityContainers || 0) +
                  (sourceItem.quantityContainers || 0);

                await tx
                  .update(finishedGoodsStock)
                  .set({
                    quantityCartons: newCartons,
                    quantityContainers: newContainers,
                  })
                  .where(eq(finishedGoodsStock.id, targetItem.id));

                await tx
                  .delete(finishedGoodsStock)
                  .where(eq(finishedGoodsStock.id, sourceItem.id));
              } else {
                // Move source item to target warehouse
                await tx
                  .update(finishedGoodsStock)
                  .set({ warehouseId: transferToWarehouseId })
                  .where(eq(finishedGoodsStock.id, sourceItem.id));
              }
            }
          }

          // Update Warehouse Status
          await tx
            .update(warehouses)
            .set({ isActive })
            .where(eq(warehouses.id, warehouseId));
        });

        return { success: true };
      } catch (error) {
        console.error("Failed to toggle warehouse status:", error);
        throw new Error("Failed to update warehouse status");
      }
    },
  );
