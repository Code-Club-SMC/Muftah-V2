import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import { inArray } from "drizzle-orm";
import Big from "big.js";
import { db, inventoryAuditLog, stockTransfers, warehouses } from "@/db";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { transferStockSchema } from "@/lib/validators/validators";
import {
  transferFinishedStock,
  transferMaterialStock,
} from "./transfer-stock-core.server";

const validatedTransferSchema = transferStockSchema.superRefine((data, ctx) => {
  const quantity = Number(data.quantity);
  const loose = Number(data.looseUnits || "0");
  const decimal = /^\d+(?:\.\d+)?$/;
  if (
    !decimal.test(data.quantity) ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    quantity > 999_999_999.999 ||
    !new Big(data.quantity).round(3).eq(data.quantity)
  )
    ctx.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "Enter a nonnegative quantity with up to three decimal places",
    });
  if (
    !decimal.test(data.looseUnits || "0") ||
    !Number.isSafeInteger(loose) ||
    loose < 0
  )
    ctx.addIssue({
      code: "custom",
      path: ["looseUnits"],
      message: "Loose units must be a nonnegative whole number",
    });
  if (data.materialType === "finished") {
    if (!Number.isSafeInteger(quantity))
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Cartons must be a whole number",
      });
  } else if (quantity <= 0 || loose !== 0)
    ctx.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "Raw transfers require a positive quantity and no loose units",
    });
});

export const transferStockFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(validatedTransferSchema)
  .handler(async ({ data, context }) => {
    if (data.fromWarehouseId === data.toWarehouseId)
      throw new Error("Source and destination warehouses must be different");
    return db.transaction(async (tx) => {
      const locations = await tx
        .select()
        .from(warehouses)
        .where(
          inArray(warehouses.id, [data.fromWarehouseId, data.toWarehouseId]),
        )
        .orderBy(warehouses.id)
        .for("share");
      const fromWarehouse = locations.find(
        (row) => row.id === data.fromWarehouseId,
      );
      const toWarehouse = locations.find(
        (row) => row.id === data.toWarehouseId,
      );
      if (!fromWarehouse || !toWarehouse)
        throw new Error("Warehouse not found");
      if (!fromWarehouse.isActive || !toWarehouse.isActive)
        throw new Error("Stock transfers require active warehouses");
      if (
        data.materialType !== "finished" &&
        toWarehouse.type !== "factory_floor"
      )
        throw new Error(
          "Raw materials can only be transferred to a Factory Floor facility",
        );
      const id = createId();
      const loose = Number(data.looseUnits || "0");
      if (data.materialType === "finished") {
        await transferFinishedStock(tx, {
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          recipeId: data.materialId,
          cartons: Number(data.quantity),
          looseUnits: loose,
          userId: context.session.user.id,
          referenceId: id,
        });
      } else {
        await transferMaterialStock(tx, {
          ...data,
          materialType: data.materialType,
        });
        await tx.insert(inventoryAuditLog).values([
          {
            warehouseId: data.fromWarehouseId,
            materialType: data.materialType,
            materialId: data.materialId,
            type: "debit",
            amount: data.quantity,
            reason: "Transfer Out",
            performedById: context.session.user.id,
            referenceId: id,
          },
          {
            warehouseId: data.toWarehouseId,
            materialType: data.materialType,
            materialId: data.materialId,
            type: "credit",
            amount: data.quantity,
            reason: "Transfer In",
            performedById: context.session.user.id,
            referenceId: id,
          },
        ]);
      }
      const [transfer] = await tx
        .insert(stockTransfers)
        .values({
          id,
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          materialType: data.materialType,
          materialId: data.materialId,
          quantity: data.quantity,
          performedById: context.session.user.id,
          notes:
            `${data.notes || ""}${loose ? ` (+ ${loose} loose units)` : ""}`.trim(),
          status: "completed",
        })
        .returning();
      logActivityQuiet({
        module: "inventory",
        action: "transferred",
        entityType: "stock",
        entityLabel: data.materialId,
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `Transferred ${data.quantity} units from ${fromWarehouse.name} to ${toWarehouse.name}`,
      });
      return transfer;
    });
  });
