import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { packagingAllocations } from "@/db/schemas/production-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

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

    return await db.transaction(async (tx) => {
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
  });
