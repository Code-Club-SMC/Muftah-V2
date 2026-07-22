import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";

export const getWarehousesFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .handler(async () => {
    const results = await db.query.warehouses.findMany({
      orderBy: (w, { asc }) => [asc(w.name)],
    });

    return results;
  });
