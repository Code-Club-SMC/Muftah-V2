import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import { eq, inArray, sql } from "drizzle-orm";
import Big from "big.js";
import {
  db,
  chemicals,
  inventoryAuditLog,
  packagingMaterials,
  stockTransfers,
  warehouses,
} from "@/db";
import type { PickedLot } from "@/lib/inventory/material-lots";
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
      let picked: PickedLot[] = [];
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
        if (!data.lotPicks?.length) throw new Error("Pick the lots to move");
        const [item] =
          data.materialType === "chemical"
            ? await tx
                .select({ name: chemicals.name, unit: chemicals.unit })
                .from(chemicals)
                .where(eq(chemicals.id, data.materialId))
            : await tx
                .select({ name: packagingMaterials.name, unit: sql<string>`'pcs'` })
                .from(packagingMaterials)
                .where(eq(packagingMaterials.id, data.materialId));
        if (!item) throw new Error("Material not found");
        picked = await transferMaterialStock(tx, {
          ...data,
          materialType: data.materialType,
          picks: data.lotPicks,
          name: item.name,
          unit: item.unit,
          referenceId: id,
        });
        await tx.insert(inventoryAuditLog).values(
          picked.flatMap((row) => [
            {
              warehouseId: data.fromWarehouseId,
              materialType: data.materialType,
              materialId: data.materialId,
              type: "debit",
              amount: row.quantity,
              lotId: row.lotId,
              reason: "Transfer Out",
              performedById: context.session.user.id,
              referenceId: id,
            },
            {
              warehouseId: data.toWarehouseId,
              materialType: data.materialType,
              materialId: data.materialId,
              type: "credit",
              amount: row.quantity,
              lotId: row.lotId,
              reason: "Transfer In",
              performedById: context.session.user.id,
              referenceId: id,
            },
          ]),
        );
      }
      const transferRow = {
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        materialType: data.materialType,
        materialId: data.materialId,
        performedById: context.session.user.id,
        notes:
          `${data.notes || ""}${loose ? ` (+ ${loose} loose units)` : ""}`.trim(),
        status: "completed",
      };
      // Raw materials get one transfer row per picked lot; the first keeps the transfer id.
      const [transfer] = await tx
        .insert(stockTransfers)
        .values(
          picked.length
            ? picked.map((row, index) => ({
                ...transferRow,
                id: index === 0 ? id : createId(),
                quantity: row.quantity,
                lotId: row.lotId,
              }))
            : [{ ...transferRow, id, quantity: data.quantity }],
        )
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
