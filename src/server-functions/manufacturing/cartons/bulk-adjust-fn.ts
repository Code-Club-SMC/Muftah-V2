import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { bulkAdjustSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const bulkAdjustCartonsFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(bulkAdjustSchema)
  .handler(async ({ data, context }) => {
    const canBulk =
      context.authContext.permissions.has("manufacturing.carton.bulk") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canBulk) {
      throw new Error("You do not have permission to bulk adjust cartons. Supervisor access required.");
    }

    return service.bulkAdjustCartons(
      data.cartonIds,
      data.delta,
      data.strategy,
      data.reason,
      context.session.user.id,
    );
  });