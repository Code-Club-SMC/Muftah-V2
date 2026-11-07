import Big from "big.js";

export function stockStatus(
  quantity: string | number,
  minimum: string | number | null,
): "out" | "low" | "healthy" {
  const current = new Big(quantity);
  const min = new Big(minimum ?? 0);
  return current.lte(0)
    ? "out"
    : min.gt(0) && current.lte(min)
      ? "low"
      : "healthy";
}
