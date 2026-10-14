import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { batchPackingSchema, recordBatchPackingCore } from "./batch-packing-core.server";

export const recordBatchPackingFn = createServerFn({ method: "POST" })
  .middleware([requireAuthMiddleware])
  .inputValidator(batchPackingSchema)
  .handler(({ data, context }) => db.transaction(tx => recordBatchPackingCore(tx, data, {
    id: context.session.user.id, permissions: context.authContext.permissions,
  })));
