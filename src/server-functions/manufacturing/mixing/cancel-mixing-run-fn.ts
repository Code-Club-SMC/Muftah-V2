import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { mixingRuns } from "@/db/schemas/production-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { logActivityQuiet } from "@/lib/activity-logger.server";

export const cancelMixingRunFn = createServerFn()
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const cancelled = await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(mixingRuns)
        .where(eq(mixingRuns.id, data.id))
        .for("update");

      if (!run) throw new Error("Mixing batch not found");
      if (run.status !== "scheduled") {
        throw new Error("Only scheduled mixing batches can be cancelled");
      }

      const [updated] = await tx
        .update(mixingRuns)
        .set({
          status: "cancelled",
          closedBy: context.session.user.id,
        })
        .where(eq(mixingRuns.id, data.id))
        .returning();

      return updated;
    });

    await logActivityQuiet({
      module: "manufacturing",
      action: "cancelled",
      entityType: "mixing_run",
      entityId: cancelled.id,
      entityLabel: cancelled.batchId,
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Cancelled scheduled mixing batch ${cancelled.batchId}`,
      metadata: { previousStatus: "scheduled" },
      severity: "warning",
    });

    return cancelled;
  });
