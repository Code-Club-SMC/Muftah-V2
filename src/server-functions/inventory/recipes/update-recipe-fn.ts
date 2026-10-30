import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  recipes,
  finishedGoodsStock,
  recipePackaging,
  packagingMaterials,
} from "@/db/schemas/inventory-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { updateRecipeSchema } from "@/lib/validators/validators";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { getPlannedPackagingQuantity, normalizePackagingUsageBasis } from "@/lib/recipe-packaging";
import { getPackagingTarget } from "@/lib/production/packaging-quantity";
import { formulas, packagingAllocations } from "@/db/schemas/production-schema";

export const updateRecipeFn = createServerFn({ method: "POST" })
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(updateRecipeSchema)
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(recipes).where(eq(recipes.id, data.id)).for("update");
      if (!existing) throw new Error("Packaging Format not found");
      const allocation = await tx.query.packagingAllocations.findFirst({
        where: (allocation, { and, eq, ne }) => and(eq(allocation.recipeId, data.id), ne(allocation.status, "cancelled")),
      });
      if (allocation) throw new Error("This packaging format has packing jobs. Create a new packaging format to change its packaging definition");
      const stock = await tx.query.finishedGoodsStock.findFirst({ where: and(eq(finishedGoodsStock.recipeId, data.id), or(gt(finishedGoodsStock.quantityCartons, 0), gt(finishedGoodsStock.quantityContainers, 0), gt(finishedGoodsStock.quantityOutsidePacks, 0))) });
      if (stock) throw new Error("This packaging format has finished stock. Create a new format to change its packaging definition");
      const formulaId = data.formulaId ?? existing.formulaId;
      const [linkedFormula] = await tx.select().from(formulas).where(eq(formulas.id, formulaId)).for("share");
      if (!linkedFormula || !linkedFormula.isActive || linkedFormula.productId !== data.productId) {
        throw new Error("An active mixing formula for the same product is required");
      }
      // The stored formula is authoritative for bulk compatibility.
      updateRecipeSchema.parse({ ...data, batchSize: linkedFormula.batchSize, batchUnit: linkedFormula.batchUnit });
      const targetUnits = getPackagingTarget(linkedFormula.batchSize, data.fillAmount, data.fillUnit, linkedFormula.batchUnit);
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
      

      // Calculate ingredients cost
      const ingredientsCost = Number(linkedFormula?.estimatedIngredientsCost ?? 0);

      // Calculate packaging cost (containers)
      const containerCost = parseFloat(
        containerPackaging.costPerUnit?.toString() || "0",
      );
      const containersCost = targetUnits * containerCost;

      // Calculate cartons cost
      let cartonsCost = 0;
      if (cartonPackaging && data.containersPerCarton > 0 && targetUnits > 0) {
        const cartonsNeeded = Math.ceil(targetUnits / data.containersPerCarton);
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

      // 4. Update the recipe
      const [recipe] = await tx
        .update(recipes)
        .set({
          productId: data.productId,
          formulaId,
          name: data.name,
          batchSize: linkedFormula.batchSize,
          batchUnit: linkedFormula.batchUnit,
          targetUnitsPerBatch: targetUnits,
          fillAmount: data.fillAmount || null,
          fillUnit: data.fillUnit || null,
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
        .where(eq(recipes.id, data.id))
        .returning();

      // 6. Update additional packaging (Delete and recreate)
      await tx
        .delete(recipePackaging)
        .where(eq(recipePackaging.recipeId, data.id));
      if (data.additionalPackaging && data.additionalPackaging.length > 0) {
        await tx.insert(recipePackaging).values(
          data.additionalPackaging.map((pkg) => ({
            recipeId: data.id,
            packagingMaterialId: pkg.packagingMaterialId,
            quantityPerContainer: pkg.quantityPerContainer.toString(),
            usageBasis: normalizePackagingUsageBasis(pkg.usageBasis),
          })),
        );
      }

      return recipe;
    });
  });
