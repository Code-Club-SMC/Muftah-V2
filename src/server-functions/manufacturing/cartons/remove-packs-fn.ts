import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { removePacksSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const removePacksFromCartonFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(removePacksSchema)
  .handler(async ({ data, context }) => {
    const canRemove =
      hasPermission(context.authContext.permissions, "manufacturing.carton.remove") ||
      hasPermission(context.authContext.permissions, "manufacturing.run.manage");

    if (!canRemove) {
      throw new Error("You do not have permission to remove packs from cartons.");
    }

    return service.removePacksFromCarton(
      data.cartonId,
      data.delta,
      context.session.user.id,
      data.reason,
      data.notes,
    );
  });