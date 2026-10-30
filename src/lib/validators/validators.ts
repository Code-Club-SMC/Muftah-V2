import { z } from "zod";
import Big from "big.js";
import { PACKAGING_USAGE_BASIS } from "@/lib/recipe-packaging";
import { lotPickSchema } from "@/lib/inventory/material-lots";
import { calculatePackingLine } from "@/lib/production/batch-packing";

export const createRecipeSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  formulaId: z.string().min(1, "Bulk formula is required"),
  name: z.string().trim().min(1, "Format name is required").max(100, "Format name must be 100 characters or less"),
  batchSize: z.string().min(1, "Batch size is required"),
  batchUnit: z.enum(["kg", "liters"]),
  // Pack size configuration
  fillAmount: z.string().refine(value => /^\d+(?:\.\d{1,3})?$/.test(value) && Number(value) > 0 && Number(value) <= 9_999_999.999, "Fill amount must be positive with at most three decimal places"), // Content per pack (e.g., "100" for 100g)
  fillUnit: z.enum(["g", "kg", "ml", "L"]), // Unit for fill amount
  targetUnitsPerBatch: z.number().int().min(0).max(2_147_483_647).default(0), // Target packs per batch (producedUnits)
  containerType: z.literal("pack"),
  containerPackagingId: z.string().trim().min(1, "Pack material is required").refine(value => value !== "_none", "Pack material is required"),
  containersPerCarton: z.number().int().min(0).max(2_147_483_647).default(0), // 0 means no cartons
  cartonPackagingId: z.string().trim().optional(),
  minimumStockLevel: z.number().int().min(0).max(2_147_483_647).default(0),
  ingredients: z.array(
    z.object({
      chemicalId: z.string().min(1, "Chemical is required"),
      quantityPerBatch: z.string().min(1, "Quantity is required"),
    }),
  ).default([]),
  additionalPackaging: z
    .array(
      z.object({
        packagingMaterialId: z
          .string().trim()
          .min(1, "Packaging material is required")
          .refine(value => value !== "_none", "Packaging material is required"),
        quantityPerContainer: z
          .number().finite()
          .positive("Quantity must be a positive number")
          .max(9_999.999999, "Quantity must be 9999.999999 or less")
          .refine(value => Number.isFinite(value) && new Big(value).round(6).eq(value), "Use at most six decimal places"),
        usageBasis: z.enum(PACKAGING_USAGE_BASIS).default("per_unit"),
      }),
    )
    .default([]),
}).superRefine((data, ctx) => {
  const usesCartons = !!data.cartonPackagingId && data.cartonPackagingId !== "_none";
  if (usesCartons !== (data.containersPerCarton > 0)) {
    ctx.addIssue({ code: "custom", path: ["containersPerCarton"], message: "Choose a carton material and enter its packs per carton together" });
  }
  if (usesCartons && data.cartonPackagingId === data.containerPackagingId) {
    ctx.addIssue({ code: "custom", path: ["cartonPackagingId"], message: "Pack and carton materials must be different" });
  }
  const materials = new Set([data.containerPackagingId]);
  if (usesCartons) materials.add(data.cartonPackagingId!);
  data.additionalPackaging.forEach((item, index) => {
    if (materials.has(item.packagingMaterialId)) {
      ctx.addIssue({ code: "custom", path: ["additionalPackaging", index, "packagingMaterialId"], message: "Each packaging material can only be used once" });
    }
    materials.add(item.packagingMaterialId);
    if (!usesCartons && item.usageBasis === "per_carton") {
      ctx.addIssue({ code: "custom", path: ["additionalPackaging", index, "usageBasis"], message: "Per carton extras require carton packaging" });
    }
  });
  try {
    calculatePackingLine(
      { fullCartons: 0, partialPacks: 0, loosePacks: 1 },
      { ...data, usesCartons },
      data.batchUnit,
    );
  } catch (error) {
    ctx.addIssue({ code: "custom", path: ["fillAmount"], message: error instanceof Error ? error.message : "Enter a valid pack content" });
  }
});

export const updateRecipeSchema = createRecipeSchema.safeExtend({
  id: z.string().min(1, "Recipe ID is required"),
});

export const addRecipeIngredientSchema = z.object({
  recipeId: z.string(),
  chemicalId: z.string(),
  quantityPerBatch: z.string(),
});

export const addRecipePackagingSchema = z.object({
  recipeId: z.string(),
  packagingMaterialId: z.string(),
  quantityPerContainer: z.number().positive(),
  usageBasis: z.enum(PACKAGING_USAGE_BASIS).default("per_unit"),
});

export const addWarehouseSchema = z.object({
  name: z.string().min(1, "Warehouse name is required"),
  address: z.string().min(1, "Address is required"),
  latitude: z.string().min(1, "Latitude is required"),
  longitude: z.string().min(1, "Longitude is required"),
});

export const addChemicalSchema = z.object({
  name: z.string().min(1, "Material name is required"),
  unit: z.enum(["kg", "liters"]),
  costPerUnit: z.string().min(1, "Cost per unit is required"),
  minimumStockLevel: z.string().min(1, "Minimum stock level is required"),
  warehouseId: z.string().min(1, "Warehouse is required"),
  quantity: z.string().min(1, "Quantity is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  // New Fields
  packagingType: z.string(),
  packagingSize: z.string(),
  notes: z.string(),
  invoiceNumber: z.string(),
  paymentMethod: z.string(),
  walletId: z.string(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]),
  amountPaid: z.string(),
  transactionId: z.string(),
  bankName: z.string(),
  confirmSimilarName: z.boolean().optional(),
});

export const addPackagingMaterialSchema = z.object({
  name: z.string().min(1, "Material name is required"),
  warehouseId: z.string().min(1, "Warehouse is required"),
  quantity: z.string().min(1, "Quantity is required"),
  costPerUnit: z.string().min(1, "Cost per unit is required"),
  minimumStockLevel: z.number().int().min(0),
  type: z.enum(["primary", "master", "sticker", "extra"]),
  capacity: z.string(),
  capacityUnit: z.string(),
  // New Fields
  weightPerPack: z.string(),
  pricePerKg: z.string(),
  associatedStickerId: z.string(),
  stickerCost: z.string(),
  supplierId: z.string().min(1, "Supplier is required"),
  notes: z.string(),
  invoiceNumber: z.string(),
  paymentMethod: z.string(),
  walletId: z.string(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]),
  amountPaid: z.string(),
  transactionId: z.string(),
  bankName: z.string(),
  confirmSimilarName: z.boolean().optional(),
});

export const addProductSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  description: z.string().optional(),
});

export const addProductVariantSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  formulaId: z.string().optional(),
  name: z.string().min(1, "Variant name is required"),
  packsPerCarton: z.number().int().min(1),
  weightPerPackKg: z.string().min(1, "Weight per pack is required"),
  retailPrice: z.string().optional(),
  hsnCode: z.string().optional(),
});

export const addBOMItemSchema = z.object({
  variantId: z.string(),
  materialType: z.enum(["chemical", "packaging"]),
  materialId: z.string(),
  quantityPerPack: z.string(),
});

export const addStockSchema = z.object({
  warehouseId: z.string().min(1, "Warehouse is required"),
  materialType: z.enum(["chemical", "packaging"]),
  materialId: z.string().min(1, "Material is required"),
  quantity: z.string().min(1, "Quantity is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  cost: z.string().min(1, "Cost is required"),
  notes: z.string(),
  paymentMethod: z.string(),
  walletId: z.string(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]),
  amountPaid: z.string(),
  transactionId: z.string(),
  bankName: z.string(),
});

export const transferStockSchema = z
  .object({
    fromWarehouseId: z.string().min(1, "Source warehouse is required"),
    toWarehouseId: z.string().min(1, "Destination warehouse is required"),
    materialType: z.enum(["chemical", "packaging", "finished"]),
    materialId: z.string().min(1, "Material is required"),
    quantity: z.string(), // Cartons (for FG) or Amount (for others)
    looseUnits: z.string(), // Loose units (only for FG)
    notes: z.string(),
    lotPicks: z.array(lotPickSchema).max(50).optional(), // Raw materials only
  })
  .refine(
    (data) => {
      const qty = parseFloat(data.quantity) || 0;
      const loose = parseFloat(data.looseUnits || "0") || 0;
      return qty > 0 || loose > 0;
    },
    {
      message:
        "At least one quantity (cartons or units) must be greater than 0",
      path: ["quantity"], // Attach error to quantity field
    },
  );

// export const createProductionRunSchema = z.object({
// 	variantId: z.string().min(1, "Product variant is required"),
// 	warehouseId: z.string().min(1, "Warehouse is required"),
// 	cartonsProduced: z.number().int().min(1, "Must produce at least 1 carton"),
// });

export const createProductionRunSchema = z.object({
  recipeId: z.string().min(1, "Recipe is required"),
  warehouseId: z.string().min(1, "Warehouse is required"),
  // ... existing code ...
  batchesProduced: z.number().int().min(1).default(1),
  cartonsProduced: z.number().int().min(0),
  looseUnitsProduced: z.number().int().min(0).default(0),
  notes: z.string(),
});

export const deleteWarehouseSchema = z.object({
  warehouseId: z.string().min(1, "Warehouse ID is required"),
  transferToWarehouseId: z.string().optional(),
});
