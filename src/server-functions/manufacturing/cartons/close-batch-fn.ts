import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { closeBatchSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

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

    return service.closeBatch(data.productionRunId, context.session.user.id, data.acknowledgeShortfall);
  });