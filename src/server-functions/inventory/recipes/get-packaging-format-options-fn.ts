import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";

// Pack setup needs product names and material choices, not warehouse stock or chemicals.
export const getPackagingFormatOptionsFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .handler(async () => {
    const [products, allPackagings] = await Promise.all([
      db.query.products.findMany({
        columns: { id: true, name: true },
        orderBy: (row, { asc }) => [asc(row.name)],
      }),
      db.query.packagingMaterials.findMany({
        columns: { id: true, name: true, type: true },
        with: {
          stock: true,
        },
        orderBy: (row, { asc }) => [asc(row.name)],
      }),
    ]);

    const packagings = allPackagings
      .filter((p) => p.stock && p.stock.some((s) => Number(s.quantity) > 0))
      .map(({ id, name, type }) => ({ id, name, type }));

    return { products, packagings };
  });
