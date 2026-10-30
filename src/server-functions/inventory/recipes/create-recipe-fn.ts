import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  recipes,
  recipePackaging,
  packagingMaterials,
} from "@/db/schemas/inventory-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { createRecipeSchema } from "@/lib/validators/validators";
import { eq, inArray } from "drizzle-orm";
import { getPlannedPackagingQuantity, normalizePackagingUsageBasis } from "@/lib/recipe-packaging";
import { getPackagingTarget } from "@/lib/production/packaging-quantity";
import { formulas } from "@/db/schemas/production-schema";

export const createRecipeFn = createServerFn({ method: "POST" })
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(createRecipeSchema)
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const [formula] = await tx.select().from(formulas).where(eq(formulas.id, data.formulaId)).for("share");
      if (!formula || !formula.isActive || formula.productId !== data.productId) {
        throw new Error("An active mixing formula for the same product is required");
      }
      // The stored formula is authoritative for bulk compatibility.
      createRecipeSchema.parse({ ...data, batchSize: formula.batchSize, batchUnit: formula.batchUnit });
      const targetUnits = getPackagingTarget(formula.batchSize, data.fillAmount, data.fillUnit, formula.batchUnit);
      if (!Number.isSafeInteger(targetUnits) || targetUnits > 2_147_483_647) {
        throw new Error("The number of packs per batch exceeds the supported limit");
      }
      if (targetUnits < 1) throw new Error("Packaging Format fill exceeds the mixing formula batch size");
      const usesCartons = !!data.cartonPackagingId && data.cartonPackagingId !== "_none";
      // Get packaging materials to calculate costs
      const containerPackaging = await tx
        .select()
        .from(packagingMaterials)
        .where(eq(packagingMaterials.id, data.containerPackagingId))
        .then((res) => res[0]);

      if (!containerPackaging) throw new Error("Container packaging material not found");
      let cartonPackaging = null;
      if (data.cartonPackagingId && data.cartonPackagingId !== "_none") {
        cartonPackaging = await tx
          .select()
          .from(packagingMaterials)
          .where(eq(packagingMaterials.id, data.cartonPackagingId))
          .then((res) => res[0]);
      }

      if (usesCartons && !cartonPackaging) throw new Error("Carton packaging material not found");

      // Calculate costs

      // Use target units from user input (or calculate fallback)

      // Calculate ingredients cost
      const ingredientsCost = Number(formula.estimatedIngredientsCost ?? 0);

      // Calculate packaging cost (containers)
      const containerCost = parseFloat(
        containerPackaging.costPerUnit?.toString() || "0",
      );
      const containersCost = targetUnits * containerCost;

      // Calculate cartons cost
      let cartonsCost = 0;
      let cartonsNeeded = 0;
      if (cartonPackaging && data.containersPerCarton > 0 && targetUnits > 0) {
        cartonsNeeded = Math.ceil(targetUnits / data.containersPerCarton);
        const cartonCost = parseFloat(
          cartonPackaging.costPerUnit?.toString() || "0",
        );
        cartonsCost = cartonsNeeded * cartonCost;
      }

      // Calculate additional packaging cost (caps, stickers, etc.)
      let additionalPackagingCost = 0;
      if (data.additionalPackaging && data.additionalPackaging.length > 0) {
        const additionalPackagingIds = data.additionalPackaging.map(
          (pkg) => pkg.packagingMaterialId,
        );
        const additionalPackagingData = await tx
          .select()
          .from(packagingMaterials)
          .where(inArray(packagingMaterials.id, additionalPackagingIds));

        additionalPackagingCost = data.additionalPackaging.reduce(
          (total, pkg) => {
            const material = additionalPackagingData.find(
              (m) => m.id === pkg.packagingMaterialId,
            );
            if (!material) throw new Error("Additional packaging material not found");
            // Shoppers in KG are counted by weight, so they can only be the pack itself.
            if (material.measuredInKg) throw new Error(`${material.name} is measured in KG, so it can only be the pack, not an extra item`);
            const costPerUnit = parseFloat(
              material.costPerUnit?.toString() || "0",
            );
            const qtyNeeded = getPlannedPackagingQuantity({
              quantityPerContainer: pkg.quantityPerContainer,
              usageBasis: pkg.usageBasis,
              targetUnits,
              containersPerCarton: data.containersPerCarton,
            });
            return total + costPerUnit * qtyNeeded;
          },
          0,
        );
      }

      const totalPackagingCost =
        containersCost + cartonsCost + additionalPackagingCost;
      const totalBatchCost = ingredientsCost + totalPackagingCost;
      const costPerContainer =
        targetUnits > 0 ? totalBatchCost / targetUnits : 0;

      // 4. Create the recipe
      const [recipe] = await tx
        .insert(recipes)
        .values({
          productId: data.productId,
          formulaId: data.formulaId || null,
          name: data.name,
          batchSize: formula.batchSize,
          batchUnit: formula.batchUnit,
          // Pack size configuration
          fillAmount: data.fillAmount || null,
          fillUnit: data.fillUnit || null,
          targetUnitsPerBatch: targetUnits,
          containerType: data.containerType,
          containerPackagingId: data.containerPackagingId,
          containersPerCarton: data.containersPerCarton || 0,
          cartonPackagingId:
            data.cartonPackagingId && data.cartonPackagingId !== "_none"
              ? data.cartonPackagingId
              : null,
          estimatedIngredientsCost: ingredientsCost.toFixed(2),
          estimatedPackagingCost: totalPackagingCost.toFixed(2),
          estimatedCostPerBatch: totalBatchCost.toFixed(2),
          estimatedCostPerContainer: costPerContainer.toFixed(4),
          minimumStockLevel: data.minimumStockLevel || 0,
        })
        .returning();

      // 6. Insert additional packaging (caps, stickers, etc.)
      if (data.additionalPackaging && data.additionalPackaging.length > 0) {
        await tx.insert(recipePackaging).values(
          data.additionalPackaging.map((pkg) => ({
            recipeId: recipe.id,
            packagingMaterialId: pkg.packagingMaterialId,
            quantityPerContainer: pkg.quantityPerContainer.toString(),
            usageBasis: normalizePackagingUsageBasis(pkg.usageBasis),
          })),
        );
      }

      return recipe;
    });
  });
