import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { formulas, formulaIngredients, mixingRuns } from "@/db/schemas/production-schema";
import { chemicals, recipes } from "@/db/schemas/inventory-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { and, eq, inArray } from "drizzle-orm";

export const updateFormulaSchema = z.object({
  id: z.string().min(1, "Mixing Formula ID is required"),
  productId: z.string().min(1, "Product is required"),
  name: z.string().min(1, "Name is required"),
  batchSize: z.number().finite().min(0.01, "Batch size must be greater than 0").max(99_999_999.99)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use at most two decimal places"),
  batchUnit: z.enum(["kg", "liters"]).default("kg"),
  productionInstructions: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  ingredients: z.array(
    z.object({
      chemicalId: z.string().min(1, "Chemical is required"),
      quantityPerBatch: z.number().finite().min(0.001, "Quantity must be greater than 0").max(9_999_999.999)
        .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, "Use at most three decimal places"),
    })
  ).min(1, "At least one ingredient is required"),
});

export const updateFormulaFn = createServerFn()
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(updateFormulaSchema)
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(formulas).where(eq(formulas.id, data.id)).for("update");
      if (!existing) throw new Error("Mixing Formula not found");
      const activeRun = await tx.query.mixingRuns.findFirst({
        where: and(eq(mixingRuns.formulaId, data.id), inArray(mixingRuns.status, ["scheduled", "in_progress"])),
      });
      if (activeRun) throw new Error("Finish or cancel active mixing work before editing its mixing formula");
      if (existing.productId !== data.productId || existing.batchUnit !== data.batchUnit) {
        const [run, recipe] = await Promise.all([
          tx.query.mixingRuns.findFirst({ where: eq(mixingRuns.formulaId, data.id) }),
          tx.query.recipes.findFirst({ where: eq(recipes.formulaId, data.id) }),
        ]);
        if (run || recipe) throw new Error("Create a new mixing formula to change the product or bulk unit of a linked mixing formula");
      }
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

      // Update the formula
      const [formula] = await tx
        .update(formulas)
        .set({
          productId: data.productId,
          name: data.name,
          batchSize: data.batchSize.toString(),
          batchUnit: data.batchUnit,
          estimatedIngredientsCost: estimatedIngredientsCost.toFixed(2),
          productionInstructions: data.productionInstructions || null,
          notes: data.notes || null,
          isActive: data.isActive,
        })
        .where(eq(formulas.id, data.id))
        .returning();

      if (!formula) {
        throw new Error("Mixing Formula not found");
      }

      // Delete existing ingredients
      await tx
        .delete(formulaIngredients)
        .where(eq(formulaIngredients.formulaId, data.id));

      // Insert new ingredients
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
