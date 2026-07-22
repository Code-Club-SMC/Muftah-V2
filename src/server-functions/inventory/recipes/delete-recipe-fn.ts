import { createServerFn } from "@tanstack/react-start";
import { eq, count } from "drizzle-orm";
import { db } from "@/db";
import {
  recipes,
  recipeIngredients,
  recipePackaging,
  productionRuns,
  productionMaterialsUsed,
  finishedGoodsStock,
} from "@/db/schemas/inventory-schema";
import { invoiceItems } from "@/db/schemas/sales-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deleteRecipeSchema = z.object({
  id: z.string(),
  force: z.boolean().optional().default(false),
});

export const deleteRecipeFn = createServerFn()
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(deleteRecipeSchema)
  .handler(async ({ data }) => {
    // Check for existing production runs
    const existingRuns = await db.query.productionRuns.findMany({
      where: (runs, { eq }) => eq(runs.recipeId, data.id),
    });

    // Check for existing finished goods stock
    const [{ fgCount }] = await db
      .select({ fgCount: count() })
      .from(finishedGoodsStock)
      .where(eq(finishedGoodsStock.recipeId, data.id));

    // Check for existing invoice items (Sales history)
    const [{ salesCount }] = await db
      .select({ salesCount: count() })
      .from(invoiceItems)
      .where(eq(invoiceItems.recipeId, data.id));

    const totalfgCount = Number(fgCount);
    const totalsalesCount = Number(salesCount);

    if ((existingRuns.length > 0 || totalfgCount > 0 || totalsalesCount > 0) && !data.force) {
      const blockers = [];
      if (existingRuns.length > 0) blockers.push(`${existingRuns.length} production run(s)`);
      if (totalfgCount > 0) blockers.push(`${totalfgCount} finished goods stock entry(s)`);
      if (totalsalesCount > 0) blockers.push(`${totalsalesCount} sales record(s)`);

      throw new Error(
        `This recipe is linked to: ${blockers.join(", ")}. Use "Force Delete" to remove the recipe. Note: Sales history will be preserved by unlinking the recipe.`,
      );
    }

    return await db.transaction(async (tx) => {
      // If force-deleting, clean up all dependent data
      if (data.force) {
        // 1. Handle Sales History: Preserve records but unlink the recipe
        await tx
          .update(invoiceItems)
          .set({ recipeId: null })
          .where(eq(invoiceItems.recipeId, data.id));

        // 2. Handle Finished Goods Stock
        await tx
          .delete(finishedGoodsStock)
          .where(eq(finishedGoodsStock.recipeId, data.id));

        // 3. Handle Production Runs and their dependencies
        if (existingRuns.length > 0) {
          // Delete production materials used for each run
          for (const run of existingRuns) {
            await tx
              .delete(productionMaterialsUsed)
              .where(eq(productionMaterialsUsed.productionRunId, run.id));
          }

          // Delete production runs
          await tx
            .delete(productionRuns)
            .where(eq(productionRuns.recipeId, data.id));
        }
      }

      // 4. Delete recipe components (Packaging & Ingredients)
      await tx
        .delete(recipePackaging)
        .where(eq(recipePackaging.recipeId, data.id));

      await tx
        .delete(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, data.id));

      // 5. Finally delete the recipe itself
      await tx.delete(recipes).where(eq(recipes.id, data.id));

      return { success: true };
    });
  });
