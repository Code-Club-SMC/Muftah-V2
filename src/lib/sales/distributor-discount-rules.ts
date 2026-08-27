export type DistributorDiscountRuleLike = {
  id?: string | null;
  recipeId?: string | null;
  ruleType?: string | null;
  quantityThreshold?: number | string | null;
  freeUnits?: number | string | null;
  isActive?: boolean | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
};

const toPositiveNumber = (value: number | string | null | undefined) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const toDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function isActiveDistributorDiscountRule(
  rule: DistributorDiscountRuleLike,
  now: Date = new Date(),
) {
  if (rule.isActive === false) return false;

  const effectiveFrom = toDate(rule.effectiveFrom);
  const effectiveTo = toDate(rule.effectiveTo);

  if (effectiveFrom && effectiveFrom > now) return false;
  if (effectiveTo && effectiveTo < now) return false;

  return true;
}

export function selectApplicableDistributorDiscountRule<
  T extends DistributorDiscountRuleLike,
>(
  rules: T[],
  recipeId: string,
  numberOfCartons: number,
  now: Date = new Date(),
): T | null {
  const applicableRules = rules
    .filter((rule) =>
      rule.recipeId === recipeId &&
      (rule.ruleType ?? "free_units") === "free_units" &&
      isActiveDistributorDiscountRule(rule, now) &&
      toPositiveNumber(rule.quantityThreshold) > 0 &&
      toPositiveNumber(rule.freeUnits) > 0 &&
      numberOfCartons >= toPositiveNumber(rule.quantityThreshold),
    )
    .sort(
      (left, right) =>
        toPositiveNumber(right.quantityThreshold) -
        toPositiveNumber(left.quantityThreshold),
    );

  return applicableRules[0] ?? null;
}

export function getApplicableDistributorFreeCartons<
  T extends DistributorDiscountRuleLike,
>({
  rules,
  recipeId,
  numberOfCartons,
  manualFreeCartons: _manualFreeCartons = 0,
  now,
}: {
  rules: T[];
  recipeId: string;
  numberOfCartons: number;
  manualFreeCartons?: number;
  now?: Date;
}) {
  const applicableRule = selectApplicableDistributorDiscountRule(
    rules,
    recipeId,
    numberOfCartons,
    now,
  );

  if (!applicableRule) {
    return { freeCartons: 0, ruleId: null as string | null };
  }

  const threshold = toPositiveNumber(applicableRule.quantityThreshold);
  const freeUnits = toPositiveNumber(applicableRule.freeUnits);
  const rawAutoFreeCartons =
    Math.floor(numberOfCartons / threshold) * freeUnits;
  const autoFreeCartons = Math.max(0, rawAutoFreeCartons);

  return {
    freeCartons: autoFreeCartons,
    ruleId: applicableRule.id ?? null,
  };
}
