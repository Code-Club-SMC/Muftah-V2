import { createServerFn } from "@tanstack/react-start";
import { eq, count } from "drizzle-orm";
import { db } from "@/db";
import {
  recipes,
  recipeIngredients,
  recipePackaging,
  productionRuns,
  finishedGoodsStock,
} from "@/db/schemas/inventory-schema";
import { packagingAllocations } from "@/db/schemas/production-schema";
import { cartons } from "@/db/schemas/manufacturing-schema";
import { invoiceItems } from "@/db/schemas/sales-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deleteRecipeSchema = z.object({
  id: z.string(),
  force: z.boolean().optional().default(false),
});

export const deleteRecipeFn = createServerFn({ method: "POST" })
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(deleteRecipeSchema)
  .handler(async ({ data }) => {
    const [[{ runCount }], [{ allocationCount }], [{ cartonCount }]] = await Promise.all([
      db.select({ runCount: count() }).from(productionRuns).where(eq(productionRuns.recipeId, data.id)),
      db.select({ allocationCount: count() }).from(packagingAllocations).where(eq(packagingAllocations.recipeId, data.id)),
      db.select({ cartonCount: count() }).from(cartons).where(eq(cartons.recipeId, data.id)),
    ]);

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

    if (Number(runCount) + Number(allocationCount) + Number(cartonCount) + totalfgCount + totalsalesCount > 0) {
      await db.update(recipes).set({ isActive: false }).where(eq(recipes.id, data.id));
      return { success: true, archived: true };
    }

    return await db.transaction(async (tx) => {
      // Delete only recipes with no stock, production, carton, or sales history.
      await tx
        .delete(recipePackaging)
        .where(eq(recipePackaging.recipeId, data.id));

      await tx
        .delete(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, data.id));

      await tx.delete(recipes).where(eq(recipes.id, data.id));

      return { success: true, archived: false };
    });
  });
