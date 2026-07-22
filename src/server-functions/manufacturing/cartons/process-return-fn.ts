import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { returnSchema } from "@/lib/cartons/carton.schema";
import * as extService from "@/lib/cartons/carton-extended.service";

export const processReturnFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(returnSchema)
  .handler(async ({ data, context }) => {
    const canReturn =
      context.authContext.permissions.has("manufacturing.returns") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canReturn) {
      throw new Error("You do not have permission to process returns. Supervisor access required.");
    }

    return extService.processReturn(
      data.dispatchOrderId,
      data.lines,
      data.notes,
      context.session.user.id,
    );
  });