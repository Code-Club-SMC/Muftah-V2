import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  finishedGoodsStock,
  inventoryAuditLog,
  materialStock,
  warehouses,
} from "@/db";
import {
  mixingRuns,
  packagingAllocations,
} from "@/db/schemas/production-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { lockCartonStock } from "@/lib/cartons/stock-adjustment.server";
import { z } from "zod";
import {
  lockMaterialStock,
  relocateAllLots,
} from "@/lib/inventory/material-lots.server";
import { transferFinishedStock } from "./stock/transfer-stock-core.server";

const toggleWarehouseStatusSchema = z.object({
  warehouseId: z.string().min(1),
  isActive: z.boolean(),
  transferToWarehouseId: z.string().optional(),
});

export const toggleWarehouseStatusFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(toggleWarehouseStatusSchema)
  .handler(
    async ({
      data: { warehouseId, isActive, transferToWarehouseId },
      context,
    }) => {
      if (!isActive && transferToWarehouseId === warehouseId)
        throw new Error("Source and destination warehouses must be different");
      return db.transaction(async (tx) => {
        const locations = await tx
          .select()
          .from(warehouses)
          .where(
            inArray(
              warehouses.id,
              !isActive && transferToWarehouseId
                ? [warehouseId, transferToWarehouseId]
                : [warehouseId],
            ),
          )
          .orderBy(warehouses.id)
          // Blocks SHARE admission checks, while allowing audit foreign keys'
          // KEY SHARE locks from stock mutations that already hold stock locks.
          .for("no key update");
        const warehouse = locations.find((row) => row.id === warehouseId);
        if (!warehouse) throw new Error("Warehouse not found");
        if (!isActive) {
          const mixing = await tx.query.mixingRuns.findFirst({
            where: and(
              eq(mixingRuns.warehouseId, warehouseId),
              inArray(mixingRuns.status, ["scheduled", "in_progress"]),
            ),
          });
          const packaging = await tx.query.packagingAllocations.findFirst({
            where: and(
              eq(packagingAllocations.warehouseId, warehouseId),
              inArray(packagingAllocations.status, [
                "allocated",
                "in_progress",
              ]),
            ),
          });
          if (mixing || packaging)
            throw new Error(
              "Cannot deactivate a warehouse with live manufacturing work",
            );
        }
        if (!isActive && transferToWarehouseId) {
          const target = locations.find(
            (row) => row.id === transferToWarehouseId,
          );
          if (!target?.isActive)
            throw new Error("An active destination warehouse is required");
          const sourceMaterials = await tx
            .select()
            .from(materialStock)
            .where(eq(materialStock.warehouseId, warehouseId))
            .orderBy(materialStock.id)
            .for("update");
          if (
            sourceMaterials.some((item) => Number(item.quantity) > 0) &&
            target.type !== "factory_floor"
          )
            throw new Error(
              "Raw materials can only be transferred to a Factory Floor facility",
            );
          for (const item of sourceMaterials) {
            if (Number(item.quantity) <= 0) continue;
            const ref = {
              materialType: item.chemicalId ? "chemical" : "packaging",
              materialId: item.chemicalId ?? item.packagingMaterialId!,
            } as const;
            await lockMaterialStock(
              tx,
              [warehouseId, transferToWarehouseId],
              [ref],
            );
            const moved = await relocateAllLots(tx, {
              fromWarehouseId: warehouseId,
              toWarehouseId: transferToWarehouseId,
              ref,
              sourceId: warehouseId,
            });
            const audit = {
              ...ref,
              referenceId: warehouseId,
              performedById: context.session.user.id,
              reason: "Warehouse deactivation stock transfer",
            };
            await tx.insert(inventoryAuditLog).values(
              moved.flatMap((row) => [
                { ...audit, amount: row.quantity, lotId: row.lotId, warehouseId, type: "debit" },
                {
                  ...audit,
                  amount: row.quantity,
                  lotId: row.lotId,
                  warehouseId: transferToWarehouseId,
                  type: "credit",
                },
              ]),
            );
          }
          const sourceFinished = await tx
            .select()
            .from(finishedGoodsStock)
            .where(eq(finishedGoodsStock.warehouseId, warehouseId));
          // Lock all recipes across both warehouses before moving any one recipe.
          // Bulk carton operations use this same global warehouse/recipe order.
          await lockCartonStock(
            tx,
            sourceFinished.flatMap((item) => [
              { warehouseId, recipeId: item.recipeId },
              { warehouseId: transferToWarehouseId, recipeId: item.recipeId },
            ]),
          );
          for (const item of sourceFinished.sort((a, b) =>
            a.recipeId.localeCompare(b.recipeId),
          ))
            await transferFinishedStock(tx, {
              fromWarehouseId: warehouseId,
              toWarehouseId: transferToWarehouseId,
              recipeId: item.recipeId,
              relocateAll: true,
              userId: context.session.user.id,
              referenceId: warehouseId,
            });
        }
        await tx
          .update(warehouses)
          .set({ isActive, updatedAt: new Date() })
          .where(eq(warehouses.id, warehouseId));
        return { success: true };
      });
    },
  );
