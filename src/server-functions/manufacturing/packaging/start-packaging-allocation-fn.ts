import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { packagingAllocations } from "@/db/schemas/production-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

const startAllocationSchema = z.object({
  allocationId: z.string().min(1),
});

export const startPackagingAllocationFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(startAllocationSchema)
  .handler(async ({ data, context }) => {
    if (!hasPermission(context.authContext.permissions, "manufacturing.run.manage") &&
        !hasPermission(context.authContext.permissions, "operator.run.log")) {
      throw new Error("You do not have permission to manage production work.");
    }

    return await db.transaction(async (tx) => {
      const [allocation] = await tx
        .select()
        .from(packagingAllocations)
        .where(eq(packagingAllocations.id, data.allocationId))
        .for("update");

      if (!allocation) {
        throw new Error("Packing job not found");
      }
      if (allocation.operatorId !== context.session.user.id &&
          !hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
        throw new Error("This packing job is assigned to another operator");
      }

      if (allocation.status !== "allocated") {
        throw new Error("Only scheduled packing jobs can be started");
      }

      const [updatedAllocation] = await tx
        .update(packagingAllocations)
        .set({
          status: "in_progress",
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(packagingAllocations.id, data.allocationId))
        .returning();

      return {
        success: true,
        allocation: updatedAllocation, mixingRunId: updatedAllocation.mixingRunId,
      };
    });
  });
