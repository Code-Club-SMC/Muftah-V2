import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";

export const getMaterialsFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .handler(async () => {
    const [chemicals, packagings] = await Promise.all([
      db.query.chemicals.findMany({
        with: {
          stock: true,
        },
      }),
      db.query.packagingMaterials.findMany({
        with: {
          stock: true,
        },
      }),
    ]);

    return { chemicals, packagings };
  });
