export const PACKAGING_USAGE_BASIS = ["per_unit", "per_carton"] as const;

export type PackagingUsageBasis = (typeof PACKAGING_USAGE_BASIS)[number];

export function normalizePackagingUsageBasis(
  value: string | null | undefined,
): PackagingUsageBasis {
  return value === "per_carton" ? "per_carton" : "per_unit";
}

export function getPlannedPackagingQuantity(params: {
  quantityPerContainer: number | string | null | undefined;
  usageBasis: string | null | undefined;
  targetUnits: number;
  containersPerCarton: number | null | undefined;
}) {
  const quantity = Number(params.quantityPerContainer || 0);
  if (quantity <= 0 || params.targetUnits <= 0) {
    return 0;
  }

  const usageBasis = normalizePackagingUsageBasis(params.usageBasis);
  if (usageBasis === "per_carton") {
    const perCarton = Number(params.containersPerCarton || 0);
    if (perCarton <= 0) {
      return 0;
    }

    return Math.ceil(params.targetUnits / perCarton) * quantity;
  }

  return params.targetUnits * quantity;
}

export function getActualPackagingQuantity(params: {
  quantityPerContainer: number | string | null | undefined;
  usageBasis: string | null | undefined;
  actualUnits: number;
  containersPerCarton: number | null | undefined;
}) {
  const quantity = Number(params.quantityPerContainer || 0);
  if (quantity <= 0 || params.actualUnits <= 0) {
    return 0;
  }

  const usageBasis = normalizePackagingUsageBasis(params.usageBasis);
  if (usageBasis === "per_carton") {
    const perCarton = Number(params.containersPerCarton || 0);
    if (perCarton <= 0) {
      return 0;
    }

    return Math.floor(params.actualUnits / perCarton) * quantity;
  }

  return params.actualUnits * quantity;
}

