import Big, { type BigSource } from "big.js";

export type ReturnPricingLine = {
  numberOfCartons: number;
  quantity: number;
  packsPerCarton?: number | null;
  actualPackSize?: number | null;
  amount: string | number;
};

const toBig = (value: BigSource | null | undefined) => new Big(value || 0);

export function getReturnUnitsPerCarton(item: {
  packsPerCarton?: number | null;
  actualPackSize?: number | null;
}): number {
  return item.packsPerCarton || item.actualPackSize || 1;
}

export function getReturnableUnits(item: ReturnPricingLine): number {
  return (item.numberOfCartons || 0) * getReturnUnitsPerCarton(item) + (item.quantity || 0);
}

export function sumMoney(values: Array<string | number>): string {
  return values
    .reduce<Big>((total, value) => total.plus(toBig(value)), new Big(0))
    .round(2, Big.roundHalfUp)
    .toFixed(2);
}

export function getMaxRefundPerUnit(
  item: ReturnPricingLine,
  invoice: { invoiceDiscount?: string | number | null; itemsTotal: string | number },
): string {
  const units = getReturnableUnits(item);
  if (units <= 0) return "0.00";

  const lineAmount = toBig(item.amount);
  const itemsTotal = toBig(invoice.itemsTotal);
  const discountShare = itemsTotal.gt(0)
    ? toBig(invoice.invoiceDiscount).times(lineAmount).div(itemsTotal)
    : new Big(0);
  const lineNet = lineAmount.minus(discountShare);
  if (lineNet.lte(0)) return "0.00";

  // Round down so a full return can never refund more than the line net.
  return lineNet.div(units).round(2, Big.roundDown).toFixed(2);
}

export function calculateReturnLineRefund(units: number, refundPerUnit: string | number): string {
  return toBig(refundPerUnit).times(units).round(2, Big.roundHalfUp).toFixed(2);
}

export function resolveRefundPerUnit(params: {
  requested?: string | number | null;
  max: string;
  canOverride: boolean;
  overrideReason?: string | null;
  label: string;
}): { refundPerUnit: string; overridden: boolean } {
  if (params.requested == null || params.requested === "") {
    return { refundPerUnit: params.max, overridden: false };
  }

  const requested = new Big(params.requested).round(2, Big.roundHalfUp);
  if (requested.lt(0)) throw new Error("Refund per unit cannot be negative.");
  if (requested.lte(params.max)) {
    return { refundPerUnit: requested.toFixed(2), overridden: false };
  }

  if (!params.canOverride) {
    throw new Error(
      `Refund per unit for ${params.label} (Rs ${requested.toFixed(2)}) is above the invoice price (Rs ${params.max}).`,
    );
  }
  if (!params.overrideReason?.trim()) {
    throw new Error("A reason is required to refund above the invoice price.");
  }
  return { refundPerUnit: requested.toFixed(2), overridden: true };
}
