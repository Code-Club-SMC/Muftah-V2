import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { topUpSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const topUpCartonFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(topUpSchema)
  .handler(async ({ data, context }) => {
    const canTopUp =
      hasPermission(context.authContext.permissions, "manufacturing.carton.topup") ||
      hasPermission(context.authContext.permissions, "manufacturing.run.manage");

    if (!canTopUp) {
      throw new Error("You do not have permission to top up cartons.");
    }

    return service.topUpCarton(data.cartonId, data.delta, context.session.user.id, data.reason);
  });