import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { packagingAllocations } from "@/db/schemas/production-schema";
import { requireProductionWorkCompleteMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { completePackagingAllocationCore } from "./complete-packaging-allocation-core.server";

const completeAllocationSchema = z.object({
  allocationId: z.string().min(1),
  shortfallReason: z.string().optional(),
});

export const completePackagingAllocationFn = createServerFn()
  .middleware([requireProductionWorkCompleteMiddleware])
  .inputValidator(completeAllocationSchema)
  .handler(async ({ data, context }) => db.transaction(async (tx) => {
    const [allocation] = await tx.select({ operatorId: packagingAllocations.operatorId })
      .from(packagingAllocations).where(eq(packagingAllocations.id, data.allocationId)).for("update");
    if (!allocation) throw new Error("Packing Job not found");
    if (allocation.operatorId !== context.session.user.id &&
        !hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
      throw new Error("This packing job is assigned to another operator");
    }
    return completePackagingAllocationCore(tx, data.allocationId, context.session.user.id, data.shortfallReason);
  }));
