import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db, inventoryAuditLog, materialStock } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { updateStockSchema } from "@/lib/validators/validators";
import { z } from "zod";
import Big from "big.js";
import { updateOutsidePackStockCore, updateOutsidePackStockSchema } from "./update-outside-pack-stock-core.server";

export const updateOutsidePackStockFn = createServerFn({ method: "POST" })
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateOutsidePackStockSchema)
  .handler(({ data, context }) => db.transaction(tx => updateOutsidePackStockCore(tx, data, context.session.user.id)));

export const updateStockFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateStockSchema.extend({
    quantity: z.string().trim().refine(value => /^\d+(?:\.\d+)?$/.test(value) &&
      Number(value) <= 999_999_999.999 && new Big(value).round(3).eq(value),
      "Quantity must be nonnegative and use at most three decimal places"),
  }))
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const [stock] = await tx.select().from(materialStock)
        .where(eq(materialStock.id, data.stockId)).for("update");

      if (!stock) throw new Error("Stock not found");

      const currentQty = parseFloat(stock.quantity);
      const adjustmentQty = parseFloat(data.quantity);
      let newQuantity: number;
      let auditType: "credit" | "debit";
      let auditAmount: number;

      switch (data.adjustmentType) {
        case "set":
          newQuantity = adjustmentQty;
          auditType = adjustmentQty > currentQty ? "credit" : "debit";
          auditAmount = Math.abs(adjustmentQty - currentQty);
          break;
        case "add":
          newQuantity = currentQty + adjustmentQty;
          auditType = "credit";
          auditAmount = adjustmentQty;
          break;
        case "subtract":
          newQuantity = currentQty - adjustmentQty;
          if (newQuantity < 0) throw new Error("Insufficient stock");
          auditType = "debit";
          auditAmount = adjustmentQty;
          break;
      }

      const [result] = await tx
        .update(materialStock)
        .set({ quantity: newQuantity.toString(), updatedAt: new Date() })
        .where(eq(materialStock.id, data.stockId))
        .returning();

      // Audit log
      await tx.insert(inventoryAuditLog).values({
        warehouseId: stock.warehouseId,
        materialType: stock.chemicalId ? "chemical" : "packaging",
        materialId: stock.chemicalId || stock.packagingMaterialId!,
        type: auditType,
        amount: auditAmount.toString(),
        reason: data.reason,
        performedById: context.session.user.id,
        referenceId: stock.id,
      });

      return result;
    });
  });
