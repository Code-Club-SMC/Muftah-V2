import { z } from "zod";
import { PACKAGING_USAGE_BASIS } from "@/lib/recipe-packaging";

export const ingredientSelectionSchema = z.object({
  chemicalId: z.string().min(1, "Please select an ingredient"),
  quantityPerBatch: z
    .string()
    .min(1, "Quantity is required")
    .refine(
      (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
      "Quantity must be a positive number",
    ),
});

export const additionalPackagingItemSchema = z.object({
  packagingMaterialId: z.string().min(1, "Please select packaging material"),
  quantityPerContainer: z
    .number()
    .positive("Quantity must be a positive number"),
  usageBasis: z.enum(PACKAGING_USAGE_BASIS).default("per_unit"),
});

export const createRecipeSchema = z.object({
  productId: z.string().min(1, "Please select a target product"),
  name: z
    .string()
    .min(1, "Recipe name is required")
    .min(2, "Recipe name must be at least 2 characters")
    .max(100, "Recipe name must be 100 characters or less"),
  batchSize: z
    .string()
    .min(1, "Batch size is required")
    .refine(
      (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
      "Batch size must be a positive number",
    ),
  batchUnit: z.enum(["kg", "liters"]).catch("liters"),
  fillAmount: z
    .string()
    .optional()
    .refine(
      (val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) > 0),
      "Fill amount must be a positive number",
    ),
  fillUnit: z.enum(["g", "kg", "ml", "L"]).catch("ml"),
  containerType: z.literal("pack").catch("pack"),
  containerPackagingId: z.string().min(1, "Please select container packaging"),
  containersPerCarton: z
    .number()
    .int("Must be a whole number")
    .min(0, "Cannot be negative"),
  cartonPackagingId: z.string().optional(),
  producedUnits: z
    .number()
    .int("Units must be a whole number")
    .min(1, "Must produce at least 1 unit"),
  ingredients: z
    .array(ingredientSelectionSchema)
    .min(1, "Please add at least one ingredient"),
  additionalPackaging: z.array(additionalPackagingItemSchema).optional(),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type IngredientSelection = z.infer<typeof ingredientSelectionSchema>;
export type AdditionalPackagingItem = z.infer<
  typeof additionalPackagingItemSchema
>;
