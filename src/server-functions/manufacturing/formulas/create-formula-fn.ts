import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { formulas, formulaIngredients } from "@/db/schemas/production-schema";
import { chemicals } from "@/db/schemas/inventory-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { inArray } from "drizzle-orm";

export const createFormulaSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  name: z.string().min(1, "Name is required"),
  batchSize: z.number().finite().min(0.01, "Batch size must be greater than 0").max(99_999_999.99)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use at most two decimal places"),
  batchUnit: z.enum(["kg", "liters"]).default("kg"),
  productionInstructions: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  ingredients: z.array(
    z.object({
      chemicalId: z.string().min(1, "Chemical is required"),
      quantityPerBatch: z.number().finite().min(0.001, "Quantity must be greater than 0").max(9_999_999.999)
        .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, "Use at most three decimal places"),
    })
  ).min(1, "At least one ingredient is required"),
});

export const createFormulaFn = createServerFn()
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(createFormulaSchema)
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      // Get Chemicals used in ingredients to calculate estimated cost
      const chemicalIds = data.ingredients.map((ing) => ing.chemicalId);
      const chemicalsData = chemicalIds.length > 0
        ? await tx
            .select()
            .from(chemicals)
            .where(inArray(chemicals.id, chemicalIds))
        : [];

      // Calculate ingredients cost
      const estimatedIngredientsCost = data.ingredients.reduce((total, ing) => {
        const material = chemicalsData.find((m) => m.id === ing.chemicalId);
        if (!material) return total;
        const costPerUnit = parseFloat(material.costPerUnit?.toString() || "0");
        const quantity = ing.quantityPerBatch;
        return total + costPerUnit * quantity;
      }, 0);

      // Create the formula
      const [formula] = await tx
        .insert(formulas)
        .values({
          productId: data.productId,
          name: data.name,
          batchSize: data.batchSize.toString(),
          batchUnit: data.batchUnit,
          estimatedIngredientsCost: estimatedIngredientsCost.toFixed(2),
          productionInstructions: data.productionInstructions || null,
          notes: data.notes || null,
          isActive: true,
        })
        .returning();

      // Insert formula ingredients
      if (data.ingredients.length > 0) {
        await tx.insert(formulaIngredients).values(
          data.ingredients.map((ing) => ({
            formulaId: formula.id,
            chemicalId: ing.chemicalId,
            quantityPerBatch: ing.quantityPerBatch.toString(),
          }))
        );
      }

      return formula;
    });
  });
