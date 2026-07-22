import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { reopenBatchSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const reopenBatchFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(reopenBatchSchema)
  .handler(async ({ data, context }) => {
    const isAdmin = context.authContext.permissions.has("*");
    if (!isAdmin) {
      throw new Error("Only administrators can reopen a closed batch.");
    }

    return service.reopenBatch(data.productionRunId, context.session.user.id, data.reopenReason, data.force);
  });