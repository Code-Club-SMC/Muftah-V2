import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db, inventoryAuditLog, materialStock } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { updateStockSchema } from "@/lib/validators/validators";

export const updateStockFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateStockSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const stock = await tx.query.materialStock.findFirst({
        where: eq(materialStock.id, data.stockId),
      });

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
