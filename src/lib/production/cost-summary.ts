import Big from "big.js";

type PackingCosts = {
  allocatedChemicalCost: string;
  totalPackagingCost: string | null;
  totalProductionCost: string | null;
};

export function summarizePackingCosts(allocations: readonly PackingCosts[]) {
  const sum = (key: keyof PackingCosts) =>
    allocations
      .reduce(
        (total, allocation) => total.plus(allocation[key] ?? 0),
        new Big(0),
      )
      .toFixed(2);
  return {
    chemicalCost: sum("allocatedChemicalCost"),
    packagingCost: sum("totalPackagingCost"),
    totalCost: sum("totalProductionCost"),
  };
}

export function summarizeBatchCosts(
  chemicalCost: string | null,
  allocations: readonly { status: string; totalPackagingCost: string | null }[],
) {
  const packagingCost = allocations
    .filter((allocation) => allocation.status === "completed")
    .reduce(
      (total, allocation) => total.plus(allocation.totalPackagingCost ?? 0),
      new Big(0),
    );
  // Mixing already includes the chemical cost allocated to every packing receipt.
  return {
    chemicalCost:
      chemicalCost === null ? null : new Big(chemicalCost).toFixed(2),
    packagingCost: packagingCost.toFixed(2),
    totalCost:
      chemicalCost === null
        ? null
        : packagingCost.plus(chemicalCost).toFixed(2),
  };
}
