import { getPlannedPackagingQuantity } from "@/lib/recipe-packaging";

type RecipeWithDetails = {
  batchSize: string;
  batchUnit: "kg" | "liters";
  containersPerCarton: number | null;
  containerPackaging: { size: string | null; costPerUnit: string | null };
  cartonPackaging?: { costPerUnit: string | null } | null;
  ingredients: Array<{
    quantityPerBatch: string;
    chemical: { costPerUnit: string | null };
  }>;
  packaging: Array<{
    quantityPerContainer: number;
    usageBasis?: "per_unit" | "per_carton" | null;
    packagingMaterial: { costPerUnit: string | null };
  }>;
};

export function calculateRecipeCost(recipe: RecipeWithDetails) {
  // Calculate chemical costs
  const chemicalCost = recipe.ingredients.reduce((sum, ing) => {
    return (
      sum +
      parseFloat(ing.quantityPerBatch) *
      parseFloat(ing.chemical.costPerUnit || "0")
    );
  }, 0);

  // Calculate how many containers from batch
  const batchSize = parseFloat(recipe.batchSize || "0");
  const containerSize = recipe.containerPackaging?.size || "1L";
  const sizeMatch = containerSize.match(/(\d+\.?\d*)/);
  const sizeValue = sizeMatch ? parseFloat(sizeMatch[1]) : 1;
  const sizeUnit = containerSize
    .replace(sizeValue.toString(), "")
    .trim()
    .toLowerCase();

  let containerSizeInBatchUnit = sizeValue;
  if (recipe.batchUnit === "liters" && sizeUnit.includes("ml")) {
    containerSizeInBatchUnit = sizeValue / 1000;
  } else if (
    recipe.batchUnit === "kg" &&
    sizeUnit.includes("g") &&
    !sizeUnit.includes("kg")
  ) {
    containerSizeInBatchUnit = sizeValue / 1000;
  }

  const totalContainers = Math.floor(batchSize / containerSizeInBatchUnit);

  // Container cost
  const containerCost =
    totalContainers * parseFloat(recipe.containerPackaging.costPerUnit || "0");

  // Additional packaging per container (caps, stickers, etc.)
  const additionalPackagingCost = recipe.packaging.reduce((sum, pkg) => {
    const qtyNeeded = getPlannedPackagingQuantity({
      quantityPerContainer: pkg.quantityPerContainer,
      usageBasis: pkg.usageBasis,
      targetUnits: totalContainers,
      containersPerCarton: recipe.containersPerCarton,
    });
    return (
      sum + qtyNeeded * parseFloat(pkg.packagingMaterial.costPerUnit || "0")
    );
  }, 0);

  // Carton cost
  const totalCartons = recipe.containersPerCarton
    ? Math.ceil(totalContainers / recipe.containersPerCarton)
    : 0;
  const cartonCost = recipe.cartonPackaging
    ? totalCartons * parseFloat(recipe.cartonPackaging.costPerUnit || "0")
    : 0;

  const totalPackagingCost =
    containerCost + additionalPackagingCost + cartonCost;
  const totalCost = chemicalCost + totalPackagingCost;
  const costPerUnit = totalContainers > 0 ? totalCost / totalContainers : 0;

  return {
    chemicalCost,
    containerCost,
    additionalPackagingCost,
    cartonCost,
    totalPackagingCost,
    totalCost,
    totalContainers,
    totalCartons,
    costPerUnit,
  };
}
