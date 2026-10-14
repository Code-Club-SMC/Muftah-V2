import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { formulas } from "@/db/schemas/production-schema";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";

export const getFormulaByIdFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const formula = await db.query.formulas.findFirst({
      where: eq(formulas.id, data.id),
      with: {
        product: true,
        ingredients: {
          with: {
            chemical: true,
          }
        },
        recipes: true,
      },
    });

    if (!formula) {
      throw new Error("Mixing Formula not found");
    }

    return formula;
  });
