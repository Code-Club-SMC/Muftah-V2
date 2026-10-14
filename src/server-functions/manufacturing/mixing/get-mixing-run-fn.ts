import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { z } from "zod";

const getMixingRunSchema = z.object({
  id: z.string().min(1, "Mixing batch ID is required"),
});

export const getMixingRunFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .inputValidator(getMixingRunSchema)
  .handler(async ({ data, context }) => {
    const mixingRun = await db.query.mixingRuns.findFirst({
      where: (runs, { eq }) => eq(runs.id, data.id),
      with: {
        formula: {
          with: {
            recipes: true,
            ingredients: {
              with: {
                chemical: true,
              },
            },
          },
        },
        warehouse: true,
        operator: true,
        initiator: true,
        closedByUser: true,
        progressLogs: {
          with: {
            createdBy: true,
          },
          orderBy: (logs, { desc }) => [desc(logs.createdAt)],
        },
        materialsUsed: {
          with: {
            chemical: true,
          },
        },
        packagingAllocations: {
          with: {
            mixingRun: true,
            recipe: true,
            operator: true,
          },
          orderBy: (allocations, { desc }) => [desc(allocations.createdAt)],
        },
      },
    });

    if (!mixingRun) {
      throw new Error("Mixing batch not found");
    }
    if (mixingRun.operatorId !== context.session.user.id &&
        !hasPermission(context.authContext.permissions, "manufacturing.run.manage") &&
        !hasPermission(context.authContext.permissions, "manufacturing.run.read") &&
        !hasPermission(context.authContext.permissions, "manufacturing.view")) {
      throw new Error("This mixing batch is assigned to another operator");
    }

    return mixingRun;
  });
