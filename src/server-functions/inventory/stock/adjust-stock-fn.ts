import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { db } from "@/db";
import {
  materialLots,
  materialStock,
  inventoryAuditLog,
  warehouses,
  chemicals,
  packagingMaterials,
  materialAdjustments,
} from "@/db/schemas/inventory-schema";
import { lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { ADJUSTMENT_REASONS, checkAdjustmentReason, reasonCodes, reasonLabel } from "@/lib/production/material-use";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import Big from "big.js";

const adjustStockSchema = z.object({
  materialType: z.enum(["chemical", "packaging"]),
  materialId: z.string().min(1),
  lotId: z.string().min(1),
  adjustment: z.number().finite().min(-999_999_999.999).max(999_999_999.999)
    .refine(value => new Big(value).round(3).eq(value), "Use at most three decimal places"), // positive = add back, negative = remove
  reason: z.enum(reasonCodes(ADJUSTMENT_REASONS)),
  note: z.string().trim().max(500).optional(),
});

export const adjustStockFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(adjustStockSchema)
  .handler(async ({ data, context }) => {
    const reasonError = checkAdjustmentReason(data.reason, data.note, data.adjustment > 0);
    if (reasonError) throw new Error(reasonError);
    return await db.transaction(async (tx) => {
      // Get factory floor
      const [factoryFloor] = await tx.select().from(warehouses)
        .where(and(eq(warehouses.type, "factory_floor"), eq(warehouses.isActive, true)))
        .limit(1).for("share");

      if (!factoryFloor) throw new Error("Factory floor not found");

      const ref = { materialType: data.materialType, materialId: data.materialId } as const;
      await lockMaterialStock(tx, [factoryFloor.id], [ref]);
      const [lot] = await tx.select().from(materialLots).where(eq(materialLots.id, data.lotId));
      if (!lot || (data.materialType === "chemical" ? lot.chemicalId : lot.packagingMaterialId) !== data.materialId)
        throw new Error("This lot belongs to another item");
      const adjustment = new Big(data.adjustment).toFixed(3);
      const [before] = await tx.select({ quantity: materialStock.quantity }).from(materialStock)
        .where(and(
          eq(materialStock.warehouseId, factoryFloor.id),
          data.materialType === "chemical"
            ? eq(materialStock.chemicalId, data.materialId)
            : eq(materialStock.packagingMaterialId, data.materialId),
        ));
      await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: factoryFloor.id, delta: adjustment, sourceType: "adjustment", sourceId: null });
      await tx.insert(materialAdjustments).values({
        warehouseId: factoryFloor.id, materialType: data.materialType,
        chemicalId: data.materialType === "chemical" ? data.materialId : null,
        packagingMaterialId: data.materialType === "packaging" ? data.materialId : null,
        lotId: lot.id, delta: adjustment, unitPrice: lot.unitPrice,
        value: new Big(adjustment).times(lot.unitPrice).round(2).toFixed(2),
        reason: data.reason, note: data.note || null, source: "manual", performedById: context.session.user.id,
      });
      const currentQty = Number(before?.quantity ?? 0);
      const newQty = new Big(currentQty).plus(adjustment).toNumber();

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
        lotId: lot.id,
        type: data.adjustment > 0 ? "credit" : "debit",
        amount: Math.abs(data.adjustment).toString(),
        reason: `[MANUAL ADJUSTMENT] ${reasonLabel(ADJUSTMENT_REASONS, data.reason)}${data.note ? ` (${data.note})` : ""} | Material: ${materialName}`,
        performedById: context.session.user.id,
      });

      logActivityQuiet({
        module: "inventory",
        action: "updated",
        entityType: "stock",
        entityLabel: materialName,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Adjusted stock for ${materialName} by ${data.adjustment}`,
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
