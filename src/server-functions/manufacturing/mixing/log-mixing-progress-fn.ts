import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { db } from "@/db";
import {
  formulas,
  mixingRuns,
  mixingProgressLogs,
} from "@/db/schemas/production-schema";
import { requireProductionWorkLogMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { completeMixingRunCore } from "./complete-mixing-run-core.server";

const logMixingProgressSchema = z.object({
  mixingRunId: z.string().min(1, "Mixing batch ID is required"),
  quantityProduced: z.number().finite().positive("Quantity must be greater than 0"),
});

export const logMixingProgressFn = createServerFn()
  .middleware([requireProductionWorkLogMiddleware])
  .inputValidator(logMixingProgressSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const [mixingRun] = await tx
        .select()
        .from(mixingRuns)
        .where(eq(mixingRuns.id, data.mixingRunId))
        .for("update");

      if (!mixingRun) {
        throw new Error("Mixing batch not found");
      }
      if (mixingRun.operatorId !== context.session.user.id &&
          !hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
        throw new Error("This mixing batch is assigned to another operator");
      }

      if (mixingRun.status !== "in_progress") {
        throw new Error("Mixing batch must be in progress to log output");
      }

      const current = Number(mixingRun.actualBulkProduced ?? 0);
      const target = Number(mixingRun.targetBulkQuantity);
      if (Math.abs(data.quantityProduced * 1000 - Math.round(data.quantityProduced * 1000)) > 1e-6) {
        throw new Error("Mixing output supports up to three decimal places");
      }
      if (current + data.quantityProduced > target + 1e-9) {
        throw new Error("Mixing output cannot exceed the batch target");
      }

      // Add to progress logs
      await tx.insert(mixingProgressLogs).values({
        mixingRunId: mixingRun.id,
        quantityProduced: data.quantityProduced.toString(),
        createdById: context.session.user.id,
      });

      // Update actualBulkProduced
      const [updatedRun] = await tx
        .update(mixingRuns)
        .set({
          actualBulkProduced: sql`actual_bulk_produced + ${data.quantityProduced}`,
        })
        .where(eq(mixingRuns.id, mixingRun.id))
        .returning();

      // Check for auto-complete
      const currentOutput = parseFloat(updatedRun.actualBulkProduced?.toString() || "0");
      const targetOutput = parseFloat(updatedRun.targetBulkQuantity.toString());

      if (currentOutput >= targetOutput) {
        await completeMixingRunCore(
          tx,
          updatedRun.id,
          context.session.user.id,
          context.session.user.name,
          "Auto-completed: target output reached"
        );
      }

      logActivityQuiet({
        module: "manufacturing",
        action: "updated",
        entityType: "mixing_run",
        entityLabel: mixingRun.batchId,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Logged ${data.quantityProduced} ${mixingRun.bulkUnit} output for mixing batch ${mixingRun.batchId}`,
      });

      return { success: true };
    });
  });
