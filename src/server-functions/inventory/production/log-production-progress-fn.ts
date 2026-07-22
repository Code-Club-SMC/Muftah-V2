import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { productionProgressLogs, productionRuns, recipes } from "@/db/schemas/inventory-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { applyProductionProgressLog } from "./production-progress-core";

const logProgressSchema = z.object({
  productionRunId: z.string().min(1),
  unitsProduced: z.number().int().positive("Must be a positive number"),
});

export const logProductionProgressFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(logProgressSchema)
  .handler(async ({ data, context }) => {
    const canLogProgress =
      hasPermission(context.authContext.permissions, "operator.run.log") ||
      hasPermission(context.authContext.permissions, "manufacturing.run.manage");

    if (!canLogProgress) {
      throw new Error("You do not have permission to log production progress.");
    }

    return await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(productionRuns)
        .where(eq(productionRuns.id, data.productionRunId));

      if (!run) {
        throw new Error("Production run not found");
      }

      if (run.status !== "in_progress") {
        throw new Error("Run is not in progress");
      }

      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, run.recipeId));

      if (!recipe) {
        throw new Error("Recipe not found");
      }

      const [progressLog] = await tx
        .insert(productionProgressLogs)
        .values({
          productionRunId: run.id,
          unitsProduced: data.unitsProduced,
          createdById: context.session.user.id,
        })
        .returning();

      return applyProductionProgressLog({
        tx,
        run,
        recipe,
        unitsProduced: data.unitsProduced,
        performedById: context.session.user.id,
        progressLogId: progressLog.id,
      });
    });
  });
