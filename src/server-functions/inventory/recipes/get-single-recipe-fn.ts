import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recipes } from "@/db/schemas/inventory-schema";
import { withLiveEstimates } from "@/lib/production/cost-estimate.server";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const getRecipeParams = z.object({
  id: z.string(),
});

export const getRecipeFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .inputValidator(getRecipeParams)
  .handler(async ({ data }) => {
    const result = await db.query.recipes.findFirst({
      where: eq(recipes.id, data.id),
      with: {
        product: true,
        formula: true,
        containerPackaging: true,
        cartonPackaging: true,
        ingredients: {
          with: {
            chemical: true,
          },
        },
        packaging: {
          with: {
            packagingMaterial: true,
          },
        },
      },
    });

    if (!result) {
      throw new Error("Packaging Format not found");
    }

    const [live] = await withLiveEstimates(db, [result]);
    return live;
  });
