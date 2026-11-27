import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { lotPickSchema } from "@/lib/inventory/material-lots";
import { requireFailedBatchRecoveryMiddleware } from "@/lib/middlewares";
import {
  logChemicalSettlements,
  settleFailedBatchChemical,
} from "./failed-batch-settlement.server";

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
  .handler(async ({ data, context }) => {
    const actor = {
      id: context.session.user.id,
      name: context.session.user.name,
      permissions: context.authContext.permissions,
    };
    const result = await db.transaction((tx) => settleFailedBatchChemical(tx, data, actor));
    await logChemicalSettlements([result], actor, "stock_adjustment");
    return result;
  });
