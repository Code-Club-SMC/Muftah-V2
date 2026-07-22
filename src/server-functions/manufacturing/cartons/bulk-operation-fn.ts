import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { bulkCartonOperationSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/bulk.service";

export const executeBulkCartonOperationFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(bulkCartonOperationSchema)
  .handler(async ({ data, context }) => {
    const canBulk =
      context.authContext.permissions.has("manufacturing.carton.bulk") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canBulk) {
      throw new Error("You do not have permission to execute bulk operations on cartons. Supervisor access required.");
    }

    return service.executeBulkOperation(
      data.operationType,
      data.cartonIds,
      data.payload,
      context.session.user.id
    );
  });
