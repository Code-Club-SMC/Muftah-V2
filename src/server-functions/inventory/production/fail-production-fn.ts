import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  productionRuns,
  inventoryAuditLog,
} from "@/db/schemas/inventory-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hasPermission } from "@/lib/rbac";
import { hasOperatorProductionLogs } from "@/server-functions/inventory/stock/failed-production-recovery-core";

const failProductionSchema = z.object({
  productionRunId: z.string().min(1, "Production run ID is required"),
  reason: z.string().min(1, "Failure reason is required"),
});

export const failProductionFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(failProductionSchema)
  .handler(async ({ data, context }) => {
    const canFailRun =
      hasPermission(context.authContext.permissions, "operator.run.fail") ||
      hasPermission(context.authContext.permissions, "manufacturing.run.manage");

    if (!canFailRun) {
      throw new Error("You do not have permission to fail this production run.");
    }

    return await db.transaction(async (tx) => {
      // 1. Get the production run
      const productionRun = await tx.query.productionRuns.findFirst({
        where: eq(productionRuns.id, data.productionRunId),
        with: {
          materialsUsed: true,
        },
      });

      if (!productionRun) {
        throw new Error("Production run not found");
      }

      if (productionRun.status !== "in_progress") {
        throw new Error(
          "Only in-progress production runs can be marked as failed",
        );
      }

      if (hasOperatorProductionLogs(productionRun)) {
        throw new Error(
          "This run already has operator production logs. Complete it with shortfall instead of marking it failed.",
        );
      }

      // 2. Update production run status to failed
      await tx
        .update(productionRuns)
        .set({
          status: "failed",
          actualCompletionDate: new Date(),
          notes: productionRun.notes
            ? `${productionRun.notes}\n\n[FAILED]: ${data.reason}`
            : `[FAILED]: ${data.reason}`,
        })
        .where(eq(productionRuns.id, productionRun.id));

      // 3. Create audit log for the failure
      await tx.insert(inventoryAuditLog).values({
        warehouseId: productionRun.warehouseId,
        materialType: "finished",
        materialId: productionRun.recipeId,
        type: "debit",
        amount: "0",
        reason: `Production run ${productionRun.batchId} marked as FAILED. Reason: ${data.reason}`,
        performedById: context.session.user.id,
        referenceId: productionRun.id,
      });

      return {
        success: true,
        productionRun: {
          ...productionRun,
          status: "failed" as const,
          actualCompletionDate: new Date(),
          notes: productionRun.notes
            ? `${productionRun.notes}\n\n[FAILED]: ${data.reason}`
            : `[FAILED]: ${data.reason}`,
        },
      };
    });
  });
