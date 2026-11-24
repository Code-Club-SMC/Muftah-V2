import { roundMoney } from "@/lib/sales/settlement/money";

export function effectiveCPP(recipeContainersPerCarton: number): number {
  return recipeContainersPerCarton || 1;
}

/** A saved rate is for one carton, or for one pack when the product has no cartons. */
export function ratePerPack(rate: number | string, containersPerCarton: number | string | null | undefined): number {
  return roundMoney(Number(rate) / effectiveCPP(Number(containersPerCarton ?? 0)));
}
