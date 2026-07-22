import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { dispatchSchema } from "@/lib/cartons/carton.schema";
import * as extService from "@/lib/cartons/carton-extended.service";

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

    return extService.dispatchCartons(data.lines, data.orderId, context.session.user.id);
  });