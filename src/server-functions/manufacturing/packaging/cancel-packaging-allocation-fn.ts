import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { logActivityQuiet } from "@/lib/activity-logger.server";

const schema = z.object({
  allocationId: z.string().min(1),
  reason: z.string().optional(),
});

export const cancelPackagingAllocationFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(schema)
  .handler(async ({ data, context }) => {
    if (!hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
      throw new Error("You do not have permission to manage production work.");
    }

    const result = await db.transaction(async (tx) => {
      const [allocation] = await tx
        .select()
        .from(packagingAllocations)
        .where(eq(packagingAllocations.id, data.allocationId))
        .for("update");

      if (!allocation) throw new Error("Packing Job not found");
      if (allocation.status !== "allocated") {
        throw new Error("Only untouched packing jobs can be cancelled");
      }

      const [updated] = await tx
        .update(packagingAllocations)
        .set({
          status: "cancelled",
          notes: data.reason ? (allocation.notes ? `${allocation.notes}\nCancel reason: ${data.reason}` : `Cancel reason: ${data.reason}`) : allocation.notes,
          closedBy: context.session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(packagingAllocations.id, data.allocationId))
        .returning();

      return {
        success: true,
        allocation: updated,
        mixingRunId: updated.mixingRunId,
      };
    });

    const run = await db.query.mixingRuns.findFirst({
      where: eq(mixingRuns.id, result.mixingRunId),
      columns: { batchId: true },
    });

    await logActivityQuiet({
      module: "manufacturing",
      action: "cancelled",
      entityType: "packing_job",
      entityId: result.allocation.id,
      entityLabel: run?.batchId ?? result.allocation.id,
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Cancelled packing job for mixing batch ${run?.batchId ?? "unknown"}${data.reason ? `. Reason: ${data.reason}` : ""}`,
      metadata: { reason: data.reason ?? null, mixingRunId: result.mixingRunId },
      severity: "warning",
    });

    return result;
  });
