import { createServerFn } from "@tanstack/react-start";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { holdSchema, releaseHoldSchema } from "@/lib/cartons/carton.schema";
import * as service from "@/lib/cartons/carton.service";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { db } from "@/db";

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
    const result = await service.applyQcHold(data.cartonId, data.reason, context.session.user.id, expiresAt);

    const carton = await db.query.cartons.findFirst({
      where: (c, { eq }) => eq(c.id, data.cartonId),
      columns: { sku: true },
    });
    const shortId = data.cartonId.slice(-6).toUpperCase();
    const cartonLabel = carton?.sku ? `${carton.sku} (${shortId})` : shortId;

    logActivityQuiet({
      module: "manufacturing",
      action: "updated",
      entityType: "carton",
      entityLabel: cartonLabel,
      actorId: context.authContext.session.user.id,
      actorName: context.authContext.session.user.name,
      description: `Applied QC hold on carton ${cartonLabel} for reason: ${data.reason}`,
    });

    return result;
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

    const result = await service.releaseQcHold(
      data.cartonId,
      data.outcome,
      data.notes,
      context.session.user.id,
      isManager,
    );

    const carton = await db.query.cartons.findFirst({
      where: (c, { eq }) => eq(c.id, data.cartonId),
      columns: { sku: true },
    });
    const shortId = data.cartonId.slice(-6).toUpperCase();
    const cartonLabel = carton?.sku ? `${carton.sku} (${shortId})` : shortId;

    logActivityQuiet({
      module: "manufacturing",
      action: "updated",
      entityType: "carton",
      entityLabel: cartonLabel,
      actorId: context.authContext.session.user.id,
      actorName: context.authContext.session.user.name,
      description: `Released QC hold on carton ${cartonLabel} with outcome: ${data.outcome}`,
    });

    return result;
  });