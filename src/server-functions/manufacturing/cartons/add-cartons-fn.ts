import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { addCartonsSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const addCartonsFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(addCartonsSchema)
  .handler(async ({ data, context }) => {
    const canAdd =
      context.authContext.permissions.has("manufacturing.carton.add") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canAdd) {
      throw new Error("You do not have permission to add cartons to a batch. Supervisor access required.");
    }

    return service.addCartonsToBatch(data.productionRunId, data.count, context.session.user.id, data.zone);
  });