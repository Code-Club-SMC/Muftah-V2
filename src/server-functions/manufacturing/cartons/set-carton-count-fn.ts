import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { setCountSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const setCartonCountFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(setCountSchema)
  .handler(async ({ data, context }) => {
    const canOverride =
      context.authContext.permissions.has("manufacturing.carton.override") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canOverride) {
      throw new Error("You do not have permission to override carton counts. Supervisor access required.");
    }

    return service.setCartonCount(data.cartonId, data.newCount, context.session.user.id, data.reason);
  });