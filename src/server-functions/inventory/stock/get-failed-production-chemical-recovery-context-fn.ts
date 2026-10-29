import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { z } from "zod";
import { db } from "@/db";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import {
  calculateRecoveryLoss,
  loadFailedProductionRecoveryContext,
} from "./failed-production-recovery-core";

export const getFailedProductionChemicalRecoveryContextFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .inputValidator(
    z.object({
      batchId: z.string().min(1, "Batch ID is required"),
      chemicalId: z.string().min(1, "Chemical is required"),
    }),
  )
  .handler(async ({ data, context: auth }) =>
    db.transaction(async (tx) => {
      const context = await loadFailedProductionRecoveryContext(tx, data);
      if (context.run.operatorId !== auth.session.user.id &&
          !hasPermission(auth.authContext.permissions, "inventory.view")) {
        throw new Error("This failed mixing run is assigned to another operator");
      }

      // One entry per lot, in the order the batch took them.
      const byLot = new Map<string, { lotId: string; quantity: Big; unitPrice: string; firstPurchasedAt: string }>();
      for (const row of context.lotUsages) {
        if (!row.lotId) continue;
        const entry = byLot.get(row.lotId);
        if (entry) entry.quantity = entry.quantity.plus(row.quantityUsed);
        else byLot.set(row.lotId, { lotId: row.lotId, quantity: new Big(row.quantityUsed), unitPrice: row.costPerUnit, firstPurchasedAt: (row.firstPurchasedAt ?? row.createdAt).toISOString() });
      }
      const lotUsages = [...byLot.values()].map(row => ({ ...row, quantity: row.quantity.toFixed(3) }));
      const startedBeforeLots = context.lotUsages.some(row => !row.lotId);

      if (context.settlement) {
        const recoveredQuantity = Number(context.settlement.recoveredQuantity);
        const lossQuantity = Number(context.settlement.lossQuantity);
        const lossAmount = Number(context.settlement.lossAmount);

        return {
          batchId: context.run.batchId,
          recipeName: context.run.formula.name,
          productName: context.run.formula.product.name,
          chemicalId: context.chemical.id,
          chemicalName: context.chemical.name,
          chemicalUnit: context.chemical.unit,
          expectedQuantity: context.expectedQuantity,
          costPerUnit: context.costPerUnit,
          currentStockQty: context.currentStockQty,
          lotUsages,
          startedBeforeLots,
          alreadySettled: true,
          recoveredQuantity,
          lossQuantity,
          lossAmount,
          settledAt: context.settlement.createdAt.toISOString(),
        };
      }

      const settlementPreview = calculateRecoveryLoss({
        expectedQuantity: context.expectedQuantity,
        recoveredQuantity: context.expectedQuantity,
        costPerUnit: context.costPerUnit,
      });

      return {
        batchId: context.run.batchId,
        recipeName: context.run.formula.name,
        productName: context.run.formula.product.name,
        chemicalId: context.chemical.id,
        chemicalName: context.chemical.name,
        chemicalUnit: context.chemical.unit,
        expectedQuantity: context.expectedQuantity,
        costPerUnit: context.costPerUnit,
        currentStockQty: context.currentStockQty,
        alreadySettled: false,
        recoveredQuantity: 0,
        lossQuantity: settlementPreview.lossQuantity,
        lossAmount: settlementPreview.lossAmount,
        settledAt: null,
      };
    }),
  );
