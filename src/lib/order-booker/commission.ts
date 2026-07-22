export interface CommissionTierLike {
  minAmount: number | string;
  maxAmount: number | string | null;
  rate: number | string;
}

export interface CommissionBreakdownBand {
  minAmount: number;
  maxAmount: number | null;
  rate: number;
  bandAmount: number;
  commissionAmount: number;
}

export interface OrderBookerCommissionResult {
  amount: number;
  rate: number;
  effectiveRate: number;
  breakdown: CommissionBreakdownBand[];
  mode: "none" | "flat" | "tiered";
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function calculateOrderBookerCommission({
  fulfilledAmount,
  tiers,
  flatRate = 0,
}: {
  fulfilledAmount: number;
  tiers: CommissionTierLike[];
  flatRate?: number;
}): OrderBookerCommissionResult {
  const amount = Number.isFinite(fulfilledAmount) ? Math.max(0, fulfilledAmount) : 0;
  const normalizedFlatRate = Number.isFinite(flatRate) ? Math.max(0, flatRate) : 0;
  const breakdown: CommissionBreakdownBand[] = [];

  const sortedTiers = [...tiers].sort(
    (a, b) => Number(a.minAmount ?? 0) - Number(b.minAmount ?? 0),
  );

  for (const tier of sortedTiers) {
    const minAmount = Number(tier.minAmount ?? 0);
    const maxAmount =
      tier.maxAmount === null || tier.maxAmount === undefined
        ? null
        : Number(tier.maxAmount);
    const rate = Number(tier.rate ?? 0);

    if (!Number.isFinite(minAmount) || !Number.isFinite(rate) || rate <= 0) {
      continue;
    }

    const upperBound = maxAmount === null ? amount : Math.min(amount, maxAmount);
    const bandAmount = upperBound - minAmount;

    if (amount > minAmount && bandAmount > 0) {
      breakdown.push({
        minAmount,
        maxAmount,
        rate,
        bandAmount,
        commissionAmount: roundMoney((bandAmount * rate) / 100),
      });
    }
  }

  if (breakdown.length > 0) {
    const totalCommission = roundMoney(
      breakdown.reduce((sum, band) => sum + band.commissionAmount, 0),
    );

    return {
      amount: totalCommission,
      rate: breakdown.at(-1)?.rate ?? 0,
      effectiveRate: amount > 0 ? roundMoney((totalCommission / amount) * 100) : 0,
      breakdown,
      mode: "tiered",
    };
  }

  if (amount > 0 && normalizedFlatRate > 0) {
    const commissionAmount = roundMoney((amount * normalizedFlatRate) / 100);
    return {
      amount: commissionAmount,
      rate: normalizedFlatRate,
      effectiveRate: normalizedFlatRate,
      breakdown: [],
      mode: "flat",
    };
  }

  return {
    amount: 0,
    rate: 0,
    effectiveRate: 0,
    breakdown: [],
    mode: "none",
  };
}
