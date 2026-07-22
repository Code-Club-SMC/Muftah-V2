import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  productionRuns,
  materialStock,
  productionMaterialsUsed,
  inventoryAuditLog,
  recipes,
  recipeIngredients,
  chemicals,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

const startProductionSchema = z.object({
  productionRunId: z.string().min(1, "Production run ID is required"),
});

export const startProductionFn = createServerFn()
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(startProductionSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // 1. Get the production run
      const [productionRun] = await tx
        .select()
        .from(productionRuns)
        .where(eq(productionRuns.id, data.productionRunId));

      if (!productionRun) {
        throw new Error("Production run not found");
      }

      if (productionRun.status !== "scheduled") {
        throw new Error("Production run must be in scheduled status to start");
      }

      // 2. Get the recipe with all ingredients and packaging
      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, productionRun.recipeId));

      if (!recipe) {
        throw new Error("Recipe not found");
      }

      // 2.5 Find factory floor warehouse
      const factoryFloor = await tx.query.warehouses.findFirst({
        where: eq(warehouses.type, "factory_floor"),
      });

      if (!factoryFloor) {
        throw new Error(
          "Factory floor facility not found. Please create a facility with type 'factory_floor' first.",
        );
      }

      const ingredients = await tx
        .select({
          ingredient: recipeIngredients,
          material: chemicals,
        })
        .from(recipeIngredients)
        .leftJoin(chemicals, eq(recipeIngredients.chemicalId, chemicals.id))
        .where(eq(recipeIngredients.recipeId, recipe.id));

      // 4. Calculate total materials needed (based on batches produced)
      const batchesProduced = productionRun.batchesProduced;
      const materialsToDeduct: Array<{
        type: "chemical" | "packaging";
        materialId: string;
        materialName: string;
        quantity: number;
        costPerUnit: number;
      }> = [];

      // Add Chemicals
      for (const { ingredient, material } of ingredients) {
        if (!material) continue;
        const quantityNeeded =
          parseFloat(ingredient.quantityPerBatch) * batchesProduced;
        materialsToDeduct.push({
          type: "chemical",
          materialId: material.id,
          materialName: material.name,
          quantity: quantityNeeded,
          costPerUnit: parseFloat(material.costPerUnit?.toString() || "0"),
        });
      }

      // 5. Validate stock availability (from Factory Floor)
      for (const item of materialsToDeduct) {
        const [stock] = await tx
          .select()
          .from(materialStock)
          .where(
            and(
              eq(materialStock.warehouseId, factoryFloor.id),
              item.type === "chemical"
                ? eq(materialStock.chemicalId, item.materialId)
                : eq(materialStock.packagingMaterialId, item.materialId),
            ),
          );

        if (!stock || parseFloat(stock.quantity.toString()) < item.quantity) {
          throw new Error(
            `Insufficient stock on Factory Floor for "${item.materialName}". Available: ${stock ? parseFloat(stock.quantity.toString()).toFixed(0) : 0}, Required: ${item.quantity}`,
          );
        }
      }

      // 6. Deduct materials from Factory Floor
      let totalChemicalCost = 0;
      let totalPackagingCost = 0;

      for (const item of materialsToDeduct) {
        const totalCost = item.quantity * item.costPerUnit;

        if (item.type === "chemical") {
          totalChemicalCost += totalCost;
        } else {
          totalPackagingCost += totalCost;
        }

        // Update stock
        await tx
          .update(materialStock)
          .set({
            quantity: sql`quantity - ${item.quantity}`,
          })
          .where(
            and(
              eq(materialStock.warehouseId, factoryFloor.id),
              item.type === "chemical"
                ? eq(materialStock.chemicalId, item.materialId)
                : eq(materialStock.packagingMaterialId, item.materialId),
            ),
          );

        // Create production materials used record
        await tx.insert(productionMaterialsUsed).values({
          productionRunId: productionRun.id,
          materialType: item.type,
          materialId: item.materialId,
          quantityUsed: item.quantity.toString(),
          costPerUnit: item.costPerUnit.toString(),
          totalCost: totalCost.toString(),
        });

        // Create audit log (on Factory Floor)
        await tx.insert(inventoryAuditLog).values({
          warehouseId: factoryFloor.id,
          materialType: item.type,
          materialId: item.materialId,
          type: "debit",
          amount: item.quantity.toString(),
          reason: `Production run ${productionRun.batchId} started`,
          performedById: context.session.user.id,
          referenceId: productionRun.id,
        });
      }

      // 7. Update production run status
      const totalProductionCost = totalChemicalCost + totalPackagingCost;

      // Use the recipe's estimated cost per container for consistency
      const costPerContainer = parseFloat(
        recipe.estimatedCostPerContainer || "0",
      );

      await tx
        .update(productionRuns)
        .set({
          status: "in_progress",
          actualStartDate: new Date(),
          totalChemicalCost: totalChemicalCost.toFixed(2),
          totalPackagingCost: totalPackagingCost.toFixed(2),
          totalProductionCost: totalProductionCost.toFixed(2),
          costPerContainer: costPerContainer.toFixed(4),
        })
        .where(eq(productionRuns.id, productionRun.id));

      return {
        success: true,
        productionRun: {
          ...productionRun,
          status: "in_progress" as const,
          actualStartDate: new Date(),
        },
      };
    });
  });
