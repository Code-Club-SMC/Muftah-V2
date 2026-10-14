import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";

// Pack setup needs product names and material choices, not warehouse stock or chemicals.
export const getPackagingFormatOptionsFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .handler(async () => {
    const [products, packagings] = await Promise.all([
      db.query.products.findMany({
        columns: { id: true, name: true },
        orderBy: (row, { asc }) => [asc(row.name)],
      }),
      db.query.packagingMaterials.findMany({
        columns: { id: true, name: true, type: true },
        orderBy: (row, { asc }) => [asc(row.name)],
      }),
    ]);
    return { products, packagings };
  });
