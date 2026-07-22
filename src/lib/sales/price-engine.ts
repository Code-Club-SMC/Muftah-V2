export type PriceResolution = {
  cartonPrice: number;
  perUnitPrice: number;
  source: "default";
  agreementId: null;
  agreementType: null;
  tpBaseline: number | null;
  marginPercent: number | null;
};

export function resolvePrice(
  customerId: string,
  productId: string,
  requestedPackSize: number,
  basePackSize: number,
  defaultUnitPrice: number,
  customerDefaultMargin?: number | null,
  tpBaseline?: number | null,
): PriceResolution {
  const packRatio = requestedPackSize / (basePackSize || 1);
  const scaledBasePerUnitPrice = packRatio * defaultUnitPrice;

  if (customerDefaultMargin && customerDefaultMargin > 0 && tpBaseline) {
    const scaledTp = packRatio * tpBaseline;
    const marginFactor = Math.max(0, 1 - customerDefaultMargin / 100);
    const perUnitPrice = scaledBasePerUnitPrice * marginFactor;
    const cartonPrice = perUnitPrice * (requestedPackSize || 1);
    return {
      cartonPrice: cartonPrice,
      perUnitPrice,
      source: "default",
      agreementId: null,
      agreementType: null,
      tpBaseline: scaledTp,
      marginPercent: customerDefaultMargin,
    };
  }

  const defaultCartonPrice = scaledBasePerUnitPrice * requestedPackSize;
  return {
    cartonPrice: defaultCartonPrice,
    perUnitPrice: scaledBasePerUnitPrice,
    source: "default",
    agreementId: null,
    agreementType: null,
    tpBaseline: null,
    marginPercent: null,
  };
}
