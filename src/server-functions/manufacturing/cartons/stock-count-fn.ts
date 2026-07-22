import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { createStockCountSchema, updateStockCountLineSchema, submitStockCountSchema } from "@/lib/cartons/carton.schema";
import * as extService from "@/lib/cartons/carton-extended.service";
import * as repo from "@/lib/cartons/carton.repository";

export const createStockCountFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(createStockCountSchema)
  .handler(async ({ data, context }) => {
    const canCount =
      context.authContext.permissions.has("manufacturing.stock-count") ||
      context.authContext.permissions.has("manufacturing.run.manage") ||
      context.authContext.permissions.has("*");

    if (!canCount) {
      throw new Error("You do not have permission to create stock counts.");
    }

    return extService.createStockCountSession(data.batchId, data.sku, context.session.user.id, data.notes);
  });

const getSessionSchema = z.object({ sessionId: z.string().min(1) });

export const getStockCountSessionFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(getSessionSchema)
  .handler(async ({ data }) => {
    const session = await repo.findStockCountSessionById(data.sessionId);
    if (!session) throw new Error("Stock count session not found");
    const lines = await repo.findStockCountLinesBySessionId(data.sessionId);
    return { session, lines };
  });

export const updateStockCountLineFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(updateStockCountLineSchema)
  .handler(async ({ data }) => {
    return extService.enterPhysicalCount(data.lineId, data.physicalCount);
  });

export const submitStockCountFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(submitStockCountSchema)
  .handler(async ({ data }) => {
    return extService.submitStockCountSession(data.sessionId);
  });

const approveStockCountSchema = z.object({
  sessionId: z.string().min(1),
  approvedLines: z.array(z.object({
    lineId: z.string().min(1),
    approved: z.boolean(),
  })).min(1),
});

export const approveStockCountFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(approveStockCountSchema)
  .handler(async ({ data, context }) => {
    const canApprove =
      context.authContext.permissions.has("manufacturing.stock-count.approve") ||
      context.authContext.permissions.has("*");

    if (!canApprove) {
      throw new Error("Only managers can approve stock counts.");
    }

    return extService.approveStockCountSession(
      data.sessionId,
      data.approvedLines,
      context.session.user.id,
    );
  });