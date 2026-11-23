import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { withLiveEstimates } from "@/lib/production/cost-estimate.server";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";

export const getProductsFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .handler(async () => {
    const products = await db.query.products.findMany({
      with: {
        recipes: {
          with: {
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
            containerPackaging: true,
            cartonPackaging: true,
          },
        },
      },
    });

    const live = await withLiveEstimates(db, products.flatMap((product) => product.recipes));
    const byId = new Map(live.map((recipe) => [recipe.id, recipe]));
    return products.map((product) => ({ ...product, recipes: product.recipes.map((recipe) => byId.get(recipe.id)!) }));
  });
