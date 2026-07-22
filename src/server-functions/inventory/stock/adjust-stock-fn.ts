import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  materialStock,
  inventoryAuditLog,
  warehouses,
  chemicals,
  packagingMaterials,
} from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const adjustStockSchema = z.object({
  materialType: z.enum(["chemical", "packaging"]),
  materialId: z.string().min(1),
  adjustment: z.number(), // positive = add back, negative = remove
  reason: z.string().min(1, "Reason is required for stock adjustments"),
});

export const adjustStockFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(adjustStockSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // Get factory floor
      const factoryFloor = await tx.query.warehouses.findFirst({
        where: eq(warehouses.type, "factory_floor"),
      });

      if (!factoryFloor) throw new Error("Factory floor not found");

      // Find existing stock record
      const existingStock = await tx.query.materialStock.findFirst({
        where: and(
          eq(materialStock.warehouseId, factoryFloor.id),
          data.materialType === "chemical"
            ? eq(materialStock.chemicalId, data.materialId)
            : eq(materialStock.packagingMaterialId, data.materialId),
        ),
      });

      if (!existingStock) {
        throw new Error(
          "No stock record found for this material on the factory floor.",
        );
      }

      const currentQty = parseFloat(existingStock.quantity);
      const newQty = currentQty + data.adjustment;

      if (newQty < 0) {
        throw new Error(
          `Cannot adjust. Current stock is ${currentQty.toFixed(2)}, adjustment of ${data.adjustment} would result in negative stock.`,
        );
      }

      // Update stock
      await tx
        .update(materialStock)
        .set({
          quantity: newQty.toString(),
          updatedAt: new Date(),
        })
        .where(eq(materialStock.id, existingStock.id));

      // Get material name for audit
      let materialName = "Unknown";
      if (data.materialType === "chemical") {
        const chem = await tx.query.chemicals.findFirst({
          where: eq(chemicals.id, data.materialId),
        });
        materialName = chem?.name || "Unknown Chemical";
      } else {
        const pkg = await tx.query.packagingMaterials.findFirst({
          where: eq(packagingMaterials.id, data.materialId),
        });
        materialName = pkg?.name || "Unknown Packaging";
      }

      // Audit log
      await tx.insert(inventoryAuditLog).values({
        warehouseId: factoryFloor.id,
        materialType: data.materialType,
        materialId: data.materialId,
        type: data.adjustment > 0 ? "credit" : "debit",
        amount: Math.abs(data.adjustment).toString(),
        reason: `[MANUAL ADJUSTMENT] ${data.reason} | Material: ${materialName}`,
        performedById: context.session.user.id,
      });

      return {
        success: true,
        materialName,
        previousQty: currentQty,
        newQty,
        adjustment: data.adjustment,
      };
    });
  });
