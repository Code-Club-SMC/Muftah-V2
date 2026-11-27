import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireFailedBatchRecoveryMiddleware } from "@/lib/middlewares";
import {
  logChemicalSettlements,
  settleFailedBatchChemical,
} from "@/server-functions/inventory/stock/failed-batch-settlement.server";

const quantity = z.number().finite().min(0, "Recovered quantity cannot be negative")
  .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, "Use at most three decimal places");

const schema = z.object({
  mixingRunId: z.string().min(1),
  reason: z.string().trim().min(1, "Reason is required"),
  items: z.array(z.object({
    chemicalId: z.string().min(1),
    recoveredQuantity: quantity,
  })).min(1, "Pick at least one chemical").max(100),
}).refine(
  value => new Set(value.items.map(item => item.chemicalId)).size === value.items.length,
  "Each chemical can only appear once",
);

/**
 * Settle several chemicals of one failed batch together. All or nothing:
 * if one chemical can't be settled, none are.
 */
export const settleFailedBatchChemicalsFn = createServerFn()
  .middleware([requireFailedBatchRecoveryMiddleware])
  .inputValidator(schema)
  .handler(async ({ data, context }) => {
    const actor = {
      id: context.session.user.id,
      name: context.session.user.name,
      permissions: context.authContext.permissions,
    };

    const results = await db.transaction(async (tx) => {
      const run = await tx.query.mixingRuns.findFirst({
        where: (runs, { eq }) => eq(runs.id, data.mixingRunId),
        columns: { batchId: true },
      });
      if (!run) throw new Error("Mixing batch not found");

      const settled = [];
      for (const item of data.items) {
        settled.push(await settleFailedBatchChemical(tx, {
          batchId: run.batchId,
          chemicalId: item.chemicalId,
          recoveredQuantity: item.recoveredQuantity,
          reason: data.reason,
        }, actor));
      }
      return settled;
    });

    await logChemicalSettlements(results, actor, "failed_batch_screen");

    return {
      batchId: results[0].batchId,
      settledCount: results.length,
      totalLossAmount: results.reduce((sum, row) => sum + row.lossAmount, 0),
      results,
    };
  });
