import Big from "big.js";

export function getFillPerContainer(fillAmount: string | number | null, fillUnit: string | null, bulkUnit: string) {
  const unit = fillUnit?.toLowerCase();
  const bulk = bulkUnit.toLowerCase();
  const compatible = bulk === "liters"
    ? unit === "ml" || unit === "l" || unit === "liters"
    : bulk === "kg" && (unit === "g" || unit === "kg");
  if (!compatible || fillAmount === null) throw new Error("Packaging format fill amount and unit must match the mixing bulk unit");
  const fill = new Big(fillAmount).div(unit === "ml" || unit === "g" ? 1000 : 1);
  if (fill.lte(0)) throw new Error("Packaging format fill amount must be positive");
  return fill;
}

export function getPackagingTarget(allocatedBulk: string | number, fillAmount: string | number | null, fillUnit: string | null, bulkUnit: string) {
  return new Big(allocatedBulk).div(getFillPerContainer(fillAmount, fillUnit, bulkUnit)).round(0, Big.roundDown).toNumber();
}
