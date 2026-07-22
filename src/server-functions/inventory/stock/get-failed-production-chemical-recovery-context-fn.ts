import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";
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
  .handler(async ({ data }) =>
    db.transaction(async (tx) => {
      const context = await loadFailedProductionRecoveryContext(tx, data);

      if (context.settlement) {
        const recoveredQuantity = Number(context.settlement.recoveredQuantity);
        const lossQuantity = Number(context.settlement.lossQuantity);
        const lossAmount = Number(context.settlement.lossAmount);

        return {
          batchId: context.run.batchId,
          recipeName: context.run.recipe.name,
          productName: context.run.recipe.product.name,
          chemicalId: context.chemical.id,
          chemicalName: context.chemical.name,
          chemicalUnit: context.chemical.unit,
          expectedQuantity: context.expectedQuantity,
          costPerUnit: context.costPerUnit,
          currentStockQty: context.currentStockQty,
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
        recipeName: context.run.recipe.name,
        productName: context.run.recipe.product.name,
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
