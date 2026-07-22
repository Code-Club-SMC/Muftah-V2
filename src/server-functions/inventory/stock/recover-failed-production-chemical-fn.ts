import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  failedProductionChemicalRecoveries,
  inventoryAuditLog,
  materialStock,
} from "@/db";
import { requireFailedBatchRecoveryMiddleware } from "@/lib/middlewares";
import {
  calculateRecoveryLoss,
  loadFailedProductionRecoveryContext,
} from "./failed-production-recovery-core";

const schema = z.object({
  batchId: z.string().min(1, "Batch ID is required"),
  chemicalId: z.string().min(1, "Chemical is required"),
  recoveredQuantity: z.number().min(0, "Recovered quantity cannot be negative"),
  reason: z.string().min(1, "Reason is required"),
});

export const recoverFailedProductionChemicalFn = createServerFn()
  .middleware([requireFailedBatchRecoveryMiddleware])
  .inputValidator(schema)
  .handler(async ({ data, context }) =>
    db.transaction(async (tx) => {
      const recovery = await loadFailedProductionRecoveryContext(tx, data);

      if (recovery.settlement) {
        throw new Error("This failed batch chemical has already been settled.");
      }

      if (data.recoveredQuantity > recovery.expectedQuantity) {
        throw new Error(
          `Recovered quantity cannot exceed ${recovery.expectedQuantity.toFixed(3)} ${recovery.chemical.unit}.`,
        );
      }

      const { lossAmount, lossQuantity } = calculateRecoveryLoss({
        expectedQuantity: recovery.expectedQuantity,
        recoveredQuantity: data.recoveredQuantity,
        costPerUnit: recovery.costPerUnit,
      });

      let newQty = recovery.currentStockQty;

      if (data.recoveredQuantity > 0) {
        if (recovery.currentStock) {
          newQty = recovery.currentStockQty + data.recoveredQuantity;

          await tx
            .update(materialStock)
            .set({
              quantity: newQty.toString(),
              updatedAt: new Date(),
            })
            .where(eq(materialStock.id, recovery.currentStock.id));
        } else {
          newQty = data.recoveredQuantity;

          await tx.insert(materialStock).values({
            warehouseId: recovery.factoryFloor.id,
            chemicalId: recovery.chemical.id,
            quantity: newQty.toString(),
          });
        }

        await tx.insert(inventoryAuditLog).values({
          warehouseId: recovery.factoryFloor.id,
          materialType: "chemical",
          materialId: recovery.chemical.id,
          type: "credit",
          amount: data.recoveredQuantity.toString(),
          reason:
            `[FAILED BATCH RECOVERY] Batch ${recovery.run.batchId} returned ` +
            `${data.recoveredQuantity.toFixed(3)} ${recovery.chemical.unit} of ${recovery.chemical.name}. ${data.reason.trim()}`,
          performedById: context.session.user.id,
          referenceId: recovery.run.id,
        });
      }

      if (lossQuantity > 0) {
        await tx.insert(inventoryAuditLog).values({
          warehouseId: recovery.factoryFloor.id,
          materialType: "chemical",
          materialId: recovery.chemical.id,
          type: "debit",
          amount: "0",
          reason:
            `[FAILED BATCH LOSS] Batch ${recovery.run.batchId} wrote off ` +
            `${lossQuantity.toFixed(3)} ${recovery.chemical.unit} of ${recovery.chemical.name} ` +
            `(${lossAmount.toFixed(2)} PKR). ${data.reason.trim()}`,
          performedById: context.session.user.id,
          referenceId: recovery.run.id,
        });
      }

      await tx.insert(failedProductionChemicalRecoveries).values({
        productionRunId: recovery.run.id,
        productionMaterialUsedId: recovery.chemicalUsage.id,
        warehouseId: recovery.factoryFloor.id,
        chemicalId: recovery.chemical.id,
        expectedQuantity: recovery.expectedQuantity.toString(),
        recoveredQuantity: data.recoveredQuantity.toString(),
        lossQuantity: lossQuantity.toString(),
        costPerUnit: recovery.costPerUnit.toString(),
        lossAmount: lossAmount.toString(),
        notes: data.reason.trim(),
        settledById: context.session.user.id,
      });

      return {
        success: true,
        batchId: recovery.run.batchId,
        chemicalName: recovery.chemical.name,
        chemicalUnit: recovery.chemical.unit,
        expectedQuantity: recovery.expectedQuantity,
        recoveredQuantity: data.recoveredQuantity,
        lossQuantity,
        lossAmount,
        newQty,
      };
    }),
  );
