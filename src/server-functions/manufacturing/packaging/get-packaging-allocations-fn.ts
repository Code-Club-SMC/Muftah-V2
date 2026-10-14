import { createServerFn } from "@tanstack/react-start";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { z } from "zod";
import { db } from "@/db";
import { packagingAllocations } from "@/db/schemas/production-schema";
import { eq, and, type SQL } from "drizzle-orm";

export const getPackagingAllocationsFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .inputValidator(z.object({ allocationId: z.string().optional(), mixingRunId: z.string().optional(), status: z.string().optional() }).optional())
  .handler(async ({ data, context }) => {
      const conditions: SQL[] = [];
      if (data?.allocationId) {
        conditions.push(eq(packagingAllocations.id, data.allocationId));
      }
      if (data?.mixingRunId) {
        conditions.push(eq(packagingAllocations.mixingRunId, data.mixingRunId));
      }
      if (data?.status) {
        conditions.push(eq(packagingAllocations.status, data.status));
      }
      if (!hasPermission(context.authContext.permissions, "manufacturing.run.manage") &&
        !hasPermission(context.authContext.permissions, "manufacturing.run.read") &&
          !hasPermission(context.authContext.permissions, "manufacturing.view")) {
        conditions.push(eq(packagingAllocations.operatorId, context.session.user.id));
      }
      return { allocations: await db.query.packagingAllocations.findMany({
        where: conditions.length ? and(...conditions) : undefined,
        with: { recipe: true, mixingRun: true },
      }) };
  });
