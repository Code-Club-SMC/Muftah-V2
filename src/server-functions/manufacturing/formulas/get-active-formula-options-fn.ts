import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { formulas } from "@/db/schemas/production-schema";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";

export const getActiveFormulaOptionsFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .handler(async () =>
    db.query.formulas.findMany({
      columns: {
        id: true,
        name: true,
        productId: true,
        batchSize: true,
        batchUnit: true,
        estimatedIngredientsCost: true,
      },
      where: eq(formulas.isActive, true),
      orderBy: [asc(formulas.name), asc(formulas.id)],
    }),
  );
