import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { holdSchema, releaseHoldSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";

export const applyQcHoldFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(holdSchema)
  .handler(async ({ data, context }) => {
    const canHold =
      context.authContext.permissions.has("manufacturing.qc.hold") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canHold) {
      throw new Error("You do not have permission to apply QC holds.");
    }

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
    return service.applyQcHold(data.cartonId, data.reason, context.session.user.id, expiresAt);
  });

export const releaseQcHoldFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(releaseHoldSchema)
  .handler(async ({ data, context }) => {
    const isManager =
      context.authContext.permissions.has("manufacturing.qc.release") ||
      context.authContext.permissions.has("*");

    if (!isManager) {
      throw new Error("Only managers can release QC holds.");
    }

    return service.releaseQcHold(
      data.cartonId,
      data.outcome,
      data.notes,
      context.session.user.id,
      isManager,
    );
  });