import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { repackSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const repackCartonFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(repackSchema)
  .handler(async ({ data, context }) => {
    const canRepack =
      context.authContext.permissions.has("manufacturing.carton.repack") ||
      context.authContext.permissions.has("*");

    if (!canRepack) {
      throw new Error("You do not have permission to repack cartons. Manager access required.");
    }

    return service.repackCarton(data.cartonId, data.newCapacity, data.justification, context.session.user.id);
  });