import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { mergeSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const mergeCartonsFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(mergeSchema)
  .handler(async ({ data, context }) => {
    const canMerge =
      context.authContext.permissions.has("manufacturing.carton.merge") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canMerge) {
      throw new Error("You do not have permission to merge cartons.");
    }

    return service.mergeCartons(
      data.sourceCartonIds,
      data.destinationCartonId,
      context.session.user.id,
    );
  });