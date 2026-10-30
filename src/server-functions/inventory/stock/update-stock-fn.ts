import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { updateOutsidePackStockCore, updateOutsidePackStockSchema } from "./update-outside-pack-stock-core.server";

export const updateOutsidePackStockFn = createServerFn({ method: "POST" })
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateOutsidePackStockSchema)
  .handler(({ data, context }) => db.transaction(tx => updateOutsidePackStockCore(tx, data, context.session.user.id)));
