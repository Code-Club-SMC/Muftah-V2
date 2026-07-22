import { createServerFn } from "@tanstack/react-start";
import { eq, or } from "drizzle-orm";
import {
  db,
  finishedGoodsStock,
  inventoryAuditLog,
  materialStock,
  productionRuns,
  stockTransfers,
  warehouses,
} from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deleteWarehouseSchema = z.object({
  warehouseId: z.string().min(1),
});

export const deleteWarehouseFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(deleteWarehouseSchema)
  .handler(async ({ data: { warehouseId } }) => {
    try {
      return await db.transaction(async (tx) => {
        // 1. Integrity Check: Are there any production runs?
        const runs = await tx.query.productionRuns.findFirst({
          where: eq(productionRuns.warehouseId, warehouseId),
        });

        if (runs) {
          throw new Error(
            "Cannot delete warehouse: It has associated production history. Deactivate it instead.",
          );
        }

        // 2. Integrity Check: Are there any stock transfers?
        const transfers = await tx.query.stockTransfers.findFirst({
          where: or(
            eq(stockTransfers.fromWarehouseId, warehouseId),
            eq(stockTransfers.toWarehouseId, warehouseId),
          ),
        });

        if (transfers) {
          throw new Error(
            "Cannot delete warehouse: It has associated stock transfer records. Deactivate it instead.",
          );
        }

        // 3. Clear transient stock data
        await tx
          .delete(materialStock)
          .where(eq(materialStock.warehouseId, warehouseId));
        await tx
          .delete(finishedGoodsStock)
          .where(eq(finishedGoodsStock.warehouseId, warehouseId));

        // 4. Clear audit logs (optional, but needed for clean hard delete)
        await tx
          .delete(inventoryAuditLog)
          .where(eq(inventoryAuditLog.warehouseId, warehouseId));

        // 5. Delete the warehouse itself
        const [deleted] = await tx
          .delete(warehouses)
          .where(eq(warehouses.id, warehouseId))
          .returning();

        if (!deleted) {
          throw new Error("Warehouse not found");
        }

        return { success: true, name: deleted.name };
      });
    } catch (error: any) {
      console.error("Failed to delete warehouse:", error);
      throw new Error(
        error.message || "Failed to permanently delete warehouse",
      );
    }
  });
