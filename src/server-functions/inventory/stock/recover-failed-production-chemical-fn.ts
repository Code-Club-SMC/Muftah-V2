import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  failedProductionChemicalRecoveries,
  inventoryAuditLog,
  materialStock,
} from "@/db";
import { lotPickSchema, splitRecoveryAcrossLots } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { requireFailedBatchRecoveryMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import {
  calculateRecoveryLoss,
  loadFailedProductionRecoveryContext,
} from "./failed-production-recovery-core";

const schema = z.object({
  batchId: z.string().min(1, "Batch ID is required"),
  chemicalId: z.string().min(1, "Chemical is required"),
  recoveredQuantity: z.number().finite().min(0, "Recovered quantity cannot be negative")
    .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, "Use at most three decimal places"),
  reason: z.string().trim().min(1, "Reason is required"),
  lotReturns: z.array(lotPickSchema).max(50).optional(),
});

export const recoverFailedProductionChemicalFn = createServerFn()
  .middleware([requireFailedBatchRecoveryMiddleware])
  .inputValidator(schema)
  .handler(async ({ data, context }) =>
    db.transaction(async (tx) => {
      const recovery = await loadFailedProductionRecoveryContext(tx, data);
      if (recovery.run.operatorId !== context.session.user.id &&
          !hasPermission(context.authContext.permissions, "inventory.manage")) {
        throw new Error("This failed mixing run is assigned to another operator");
      }

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
        const ref = { materialType: "chemical", materialId: recovery.chemical.id } as const;
        await lockMaterialStock(tx, [recovery.factoryFloor.id], [ref]);
        const usages = recovery.lotUsages;
        if (usages.some(row => !row.lotId)) throw new Error("This batch was started before price lots. Contact support to recover it.");
        const recovered = new Big(data.recoveredQuantity).toFixed(3);
        const gaveByLot = new Map<string, Big>();
        for (const usage of usages) gaveByLot.set(usage.lotId!, (gaveByLot.get(usage.lotId!) ?? new Big(0)).plus(usage.quantityUsed));
        const returns = data.lotReturns ?? splitRecoveryAcrossLots(recovered, [...gaveByLot].map(([lotId, quantity]) => ({ lotId, quantity: quantity.toFixed(3), unitPrice: "0" })));
        const returned = returns.reduce((sum, row) => sum.plus(row.quantity), new Big(0));
        if (!returned.eq(recovered)) throw new Error("Lot returns must add up to the recovered quantity");
        if (new Set(returns.map(row => row.lotId)).size !== returns.length) throw new Error("Return to each lot only once");
        for (const row of returns) {
          if (new Big(row.quantity).gt(gaveByLot.get(row.lotId) ?? 0)) throw new Error("Lot returns can't be more than this batch took from that lot");
          const quantity = new Big(row.quantity).toFixed(3);
          await moveLotStock(tx, { ref, lotId: row.lotId, warehouseId: recovery.factoryFloor.id, delta: quantity, sourceType: "recovery", sourceId: recovery.run.id });
          await tx.insert(inventoryAuditLog).values({
            warehouseId: recovery.factoryFloor.id,
            materialType: "chemical",
            materialId: recovery.chemical.id,
            lotId: row.lotId,
            type: "credit",
            amount: quantity,
            reason:
              `[FAILED BATCH RECOVERY] Batch ${recovery.run.batchId} returned ` +
              `${quantity} ${recovery.chemical.unit} of ${recovery.chemical.name}. ${data.reason.trim()}`,
            performedById: context.session.user.id,
            referenceId: recovery.run.id,
          });
        }
        const [total] = await tx.select({ quantity: materialStock.quantity }).from(materialStock)
          .where(and(eq(materialStock.warehouseId, recovery.factoryFloor.id), eq(materialStock.chemicalId, recovery.chemical.id)));
        newQty = Number(total?.quantity ?? 0);
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
        mixingRunId: recovery.run.id,
        mixingMaterialUsedId: recovery.chemicalUsage.id,
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
