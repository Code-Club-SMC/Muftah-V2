import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { closeBatchSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";
import { db } from "@/db";
import { logActivityQuiet } from "@/lib/activity-logger.server";

export const closeBatchFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(closeBatchSchema)
  .handler(async ({ data, context }) => {
    const canClose =
      context.authContext.permissions.has("manufacturing.batch.close") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canClose) {
      throw new Error("You do not have permission to close production batches. Supervisor access required.");
    }

    const result = await service.closeBatch(data.productionRunId, context.session.user.id, data.acknowledgeShortfall);

    const run = await db.query.productionRuns.findFirst({
      where: (pr, { eq }) => eq(pr.id, data.productionRunId),
      columns: { batchId: true }
    });
    const batchLabel = run?.batchId || data.productionRunId;

    logActivityQuiet({
      module: "manufacturing",
      action: "updated",
      entityType: "batch",
      entityLabel: batchLabel,
      actorId: context.authContext.session.user.id,
      actorName: context.authContext.session.user.name,
      description: `Closed production run ${batchLabel}`,
    });

    return result;
  });