import Big from "big.js";
import { getPackagingTarget } from "@/lib/production/packaging-quantity";
import { getPlannedPackagingQuantity } from "@/lib/recipe-packaging";

type PricedPackaging = { costPerUnit: string | null; measuredInKg?: boolean | null; weightPerPack?: string | null };
type IngredientRow = { quantityPerBatch: string | number; chemical?: { costPerUnit: string | null } | null };
type ExtraRow = { quantityPerContainer: string | number; usageBasis: string | null; packagingMaterial: PricedPackaging };

export type FormatEstimateInput = {
  batchSize: string;
  batchUnit: string;
  targetUnitsPerBatch: number;
  fillAmount: string | null;
  fillUnit: string | null;
  containersPerCarton: number | null;
  formula?: { batchSize: string; batchUnit: string; ingredients: IngredientRow[] } | null;
  ingredients: IngredientRow[];
  containerPackaging: PricedPackaging | null;
  cartonPackaging?: PricedPackaging | null;
  packaging: ExtraRow[];
};

export function ingredientsCost(rows: IngredientRow[]) {
  return rows.reduce((total, row) => total.plus(new Big(row.quantityPerBatch).times(row.chemical?.costPerUnit ?? 0)), new Big(0));
}

// Shoppers in KG are priced per kg, so one shopper costs its weight times that price.
export function packagingPieceCost(material: PricedPackaging | null | undefined) {
  const price = new Big(material?.costPerUnit ?? 0);
  return material?.measuredInKg ? price.times(material.weightPerPack ?? 0).div(1000) : price;
}

export function packagingCost(input: {
  targetUnits: number;
  containersPerCarton: number | null;
  containerPackaging: PricedPackaging | null;
  cartonPackaging?: PricedPackaging | null;
  packaging: ExtraRow[];
}) {
  const { targetUnits, containersPerCarton } = input;
  const perCarton = containersPerCarton ?? 0;
  const cartons = input.cartonPackaging && perCarton > 0 ? Math.ceil(targetUnits / perCarton) : 0;
  return input.packaging.reduce(
    (total, row) => total.plus(packagingPieceCost(row.packagingMaterial).times(getPlannedPackagingQuantity({ ...row, targetUnits, containersPerCarton }))),
    packagingPieceCost(input.containerPackaging).times(targetUnits).plus(packagingPieceCost(input.cartonPackaging).times(cartons)),
  );
}

// A format saved before formulas existed has no formula and keeps its own ingredients and target.
function targetUnits(format: FormatEstimateInput) {
  try {
    const batch = format.formula ?? format;
    return getPackagingTarget(batch.batchSize, format.fillAmount, format.fillUnit, batch.batchUnit);
  } catch {
    return format.targetUnitsPerBatch;
  }
}

export function estimateFormat(format: FormatEstimateInput) {
  const units = targetUnits(format);
  const ingredients = ingredientsCost(format.formula?.ingredients ?? format.ingredients);
  const packaging = packagingCost({ ...format, targetUnits: units });
  const batch = ingredients.plus(packaging);
  return {
    estimatedIngredientsCost: ingredients.toFixed(2),
    estimatedPackagingCost: packaging.toFixed(2),
    estimatedCostPerBatch: batch.toFixed(2),
    // Null when one pack is bigger than the whole batch, so there is nothing to divide by.
    estimatedCostPerContainer: units > 0 ? batch.div(units).toFixed(4) : null,
  };
}
