import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { retireSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const retireCartonFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(retireSchema)
  .handler(async ({ data, context }) => {
    const isAdmin = context.authContext.permissions.has("*");
    const canRetire =
      isAdmin ||
      context.authContext.permissions.has("manufacturing.carton.retire");

    if (!canRetire) {
      throw new Error("You do not have permission to retire cartons. Manager access required.");
    }

    return service.retireCarton(
      data.cartonId,
      data.reason,
      data.notes,
      context.session.user.id,
      isAdmin,
    );
  });