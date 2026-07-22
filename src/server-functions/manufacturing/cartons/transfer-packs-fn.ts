import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { transferSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const transferPacksFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(transferSchema)
  .handler(async ({ data, context }) => {
    const canTransfer =
      context.authContext.permissions.has("manufacturing.carton.transfer") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canTransfer) {
      throw new Error("You do not have permission to transfer packs between cartons.");
    }

    return service.transferPacks(
      data.sourceCartonId,
      data.destinationCartonId,
      data.packCount,
      context.session.user.id,
    );
  });