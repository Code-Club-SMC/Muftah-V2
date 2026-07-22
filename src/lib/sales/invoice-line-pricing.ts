export type CanonicalInvoicePricingMode = "general" | "distributor";

// `retailer` remains for compatibility with the current invoice flow.
// The canonical engine treats it as `general`.
export type InvoicePricingMode = CanonicalInvoicePricingMode | "retailer";

export type CanonicalInvoiceLinePricingInput = {
  invoiceMode: CanonicalInvoicePricingMode;
  unitType: "carton" | "units";
  numberOfCartons: number;
  numberOfUnits: number;
  manualFreeCartons?: number;
  autoFreeCartons?: number;
  baseCartonRate: number;
  containersPerCarton: number;
  defaultMarginPercent?: number;
  unitCostPerPack?: number;
};

export type InvoiceLinePricingInput = {
  unitType: "carton" | "units";
  numberOfCartons: number;
  numberOfUnits: number;
  discountCartons?: number;
  freeCartons?: number;
  perCartonPrice: number;
  retailPrice: number;
  containersPerCarton: number;
  pricingMode?: InvoicePricingMode;
  marginPercent?: number;
  treatPerCartonPriceAsBaseRate?: boolean;
  unitCostPerPack?: number;
};

export type InvoiceLinePricingBreakdown = {
  invoiceMode: CanonicalInvoicePricingMode;
  unitType: "carton" | "units";
  containersPerCarton: number;
  baseCartonRate: number;
  effectiveCartonRate: number;
  baseUnitRate: number;
  effectiveUnitRate: number;
  orderedCartons: number;
  orderedUnits: number;
  freeCartonsTotal: number;
  chargedCartons: number;
  chargedUnits: number;
  dispatchedUnits: number;
  grossAmount: number;
  marginDeduction: number;
  schemeDeduction: number;
  netAmount: number;
  costOfGoodsSold: number;
  profit: number;
};

export const roundMoney = (value: number) => Number(value.toFixed(2));

export const safeContainersPerCarton = (value: number) => Math.max(1, value || 1);

const toPositiveMoney = (value: number | null | undefined) => roundMoney(Math.max(0, Number(value || 0)));

const toNonNegativeInteger = (value: number | null | undefined) =>
  Math.max(0, Number(value || 0));

export const normalizeInvoicePricingMode = (
  pricingMode: InvoicePricingMode | null | undefined,
): CanonicalInvoicePricingMode => (pricingMode === "distributor" ? "distributor" : "general");

export function calculateInvoiceLinePricing(
  input: CanonicalInvoiceLinePricingInput,
): InvoiceLinePricingBreakdown {
  const containersPerCarton = safeContainersPerCarton(input.containersPerCarton);
  const invoiceMode = input.invoiceMode;
  const unitType = input.unitType;

  const orderedCartons = unitType === "carton" ? toNonNegativeInteger(input.numberOfCartons) : 0;
  const orderedUnits = unitType === "units" ? toNonNegativeInteger(input.numberOfUnits) : 0;
  const baseCartonRate = toPositiveMoney(input.baseCartonRate);
  const defaultMarginPercent =
    invoiceMode === "distributor" ? Math.max(0, Number(input.defaultMarginPercent || 0)) : 0;
  const marginFactor = Math.max(0, 1 - defaultMarginPercent / 100);
  const effectiveCartonRate =
    invoiceMode === "distributor"
      ? roundMoney(baseCartonRate * marginFactor)
      : baseCartonRate;

  const baseUnitRate = roundMoney(baseCartonRate / containersPerCarton);
  const effectiveUnitRate = roundMoney(effectiveCartonRate / containersPerCarton);

  const manualFreeCartons =
    unitType === "carton" ? toNonNegativeInteger(input.manualFreeCartons) : 0;
  const autoFreeCartons = unitType === "carton" ? toNonNegativeInteger(input.autoFreeCartons) : 0;
  const freeCartonsTotal =
    unitType === "carton" ? manualFreeCartons + autoFreeCartons : 0;

  const chargedCartons = unitType === "carton" ? Math.max(0, orderedCartons - freeCartonsTotal) : 0;
  const chargedUnits =
    unitType === "carton" ? chargedCartons * containersPerCarton : orderedUnits;
  const dispatchedUnits =
    unitType === "carton"
      ? (orderedCartons + freeCartonsTotal) * containersPerCarton
      : orderedUnits;

  const grossAmount =
    unitType === "carton"
      ? roundMoney(orderedCartons * baseCartonRate)
      : roundMoney(orderedUnits * baseUnitRate);
  const postMarginAmount =
    unitType === "carton"
      ? roundMoney(orderedCartons * effectiveCartonRate)
      : roundMoney(orderedUnits * effectiveUnitRate);
  const marginDeduction = roundMoney(Math.max(0, grossAmount - postMarginAmount));
  const schemeDeduction =
    unitType === "carton" ? roundMoney(freeCartonsTotal * effectiveCartonRate) : 0;
  const netAmount =
    unitType === "carton"
      ? roundMoney(chargedCartons * effectiveCartonRate)
      : roundMoney(orderedUnits * effectiveUnitRate);

  const unitCostPerPack = Math.max(0, Number(input.unitCostPerPack || 0));
  const costOfGoodsSold = roundMoney(dispatchedUnits * unitCostPerPack);
  const profit = roundMoney(netAmount - costOfGoodsSold);

  return {
    invoiceMode,
    unitType,
    containersPerCarton,
    baseCartonRate,
    effectiveCartonRate,
    baseUnitRate,
    effectiveUnitRate,
    orderedCartons,
    orderedUnits,
    freeCartonsTotal,
    chargedCartons,
    chargedUnits,
    dispatchedUnits,
    grossAmount,
    marginDeduction,
    schemeDeduction,
    netAmount,
    costOfGoodsSold,
    profit,
  };
}

function resolveLegacyBaseCartonRate(
  input: InvoiceLinePricingInput,
  containersPerCarton: number,
  invoiceMode: CanonicalInvoicePricingMode,
): number {
  const storedPerCartonPrice = toPositiveMoney(input.perCartonPrice);

  if (input.treatPerCartonPriceAsBaseRate) {
    return storedPerCartonPrice;
  }

  if (storedPerCartonPrice > 0) {
    return storedPerCartonPrice;
  }

  if (invoiceMode === "general" && Number(input.retailPrice || 0) > 0) {
    return roundMoney(Math.max(0, Number(input.retailPrice || 0)) * containersPerCarton);
  }

  return storedPerCartonPrice;
}

export function resolveInvoiceLinePricing(
  input: InvoiceLinePricingInput,
): InvoiceLinePricingBreakdown {
  const invoiceMode = normalizeInvoicePricingMode(input.pricingMode);
  const containersPerCarton = safeContainersPerCarton(input.containersPerCarton);
  const shouldApplyMarginFromInput =
    invoiceMode === "distributor" &&
    Boolean(input.treatPerCartonPriceAsBaseRate || Number(input.marginPercent || 0) > 0);

  return calculateInvoiceLinePricing({
    invoiceMode,
    unitType: input.unitType,
    numberOfCartons: input.numberOfCartons || 0,
    numberOfUnits: input.numberOfUnits || 0,
    manualFreeCartons: input.discountCartons || 0,
    autoFreeCartons: input.freeCartons || 0,
    baseCartonRate: resolveLegacyBaseCartonRate(input, containersPerCarton, invoiceMode),
    containersPerCarton,
    defaultMarginPercent: shouldApplyMarginFromInput ? Number(input.marginPercent || 0) : 0,
    unitCostPerPack: input.unitCostPerPack || 0,
  });
}

export function getChargedUnits(input: InvoiceLinePricingInput): number {
  return resolveInvoiceLinePricing(input).chargedUnits;
}

export function getBillableCartons(input: InvoiceLinePricingInput): number {
  return resolveInvoiceLinePricing(input).chargedCartons;
}

export function getRevenuePerPack(input: InvoiceLinePricingInput): number {
  return resolveInvoiceLinePricing(input).effectiveUnitRate;
}

export function calculateLineAmount(input: InvoiceLinePricingInput): number {
  return resolveInvoiceLinePricing(input).netAmount;
}
