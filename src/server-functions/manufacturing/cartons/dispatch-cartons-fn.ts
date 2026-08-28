import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { dispatchSchema } from "@/lib/cartons/carton.schema";
import * as extService from "@/lib/cartons/carton-extended.service";
import { logActivityQuiet } from "@/lib/activity-logger.server";

export const dispatchCartonsFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(dispatchSchema)
  .handler(async ({ data, context }) => {
    const canDispatch =
      context.authContext.permissions.has("manufacturing.dispatch") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canDispatch) {
      throw new Error("You do not have permission to dispatch cartons.");
    }

    const result = await extService.dispatchCartons(data.lines, data.orderId, context.session.user.id);

    logActivityQuiet({
      module: "manufacturing",
      action: "updated",
      entityType: "carton",
      actorId: context.authContext.session.user.id,
      actorName: context.authContext.session.user.name,
      description: `Dispatched cartons for order ${data.orderId}`,
    });

    return result;
  });