/**
 * Customer Discount Rules Evaluator
 * 
 * This module provides functionality for evaluating and applying customer-specific
 * volume-based discount rules. It supports three discount types:
 * - carton_equivalent: Discount worth N cartons
 * - percentage: Percentage discount (0-100)
 * - fixed_amount: Fixed monetary discount
 * 
 * The evaluator filters rules by customer type eligibility, volume thresholds,
 * and date ranges, then selects the rule with the highest applicable threshold.
 */

/**
 * Calculates the invoice item amount using the corrected formula
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 * 
 * Formula: (numberOfCartons × perCartonPrice) + (quantity × perCartonPrice ÷ packsPerCarton)
 * 
 * This fixes the bug where quantity (loose packs) was incorrectly used as a multiplier
 * for perCartonPrice instead of numberOfCartons.
 * 
 * @param numberOfCartons - The number of full cartons being sold
 * @param quantity - The number of loose packs (not in cartons) being sold
 * @param perCartonPrice - The selling price for one carton of product
 * @param packsPerCarton - The number of packs in one carton
 * @returns The calculated total amount for the invoice item
 */
export function calculateInvoiceItemAmount(
  numberOfCartons: number,
  quantity: number,
  perCartonPrice: number,
  packsPerCarton: number
): number {
  const cartonAmount = numberOfCartons * perCartonPrice;
  const loosePackAmount = quantity * (perCartonPrice / packsPerCarton);
  return cartonAmount + loosePackAmount;
}

export type CustomerDiscountRule = {
  id: string;
  customerId: string;
  productId: string;
  volumeThreshold: number;
  discountType: "carton_equivalent" | "percentage" | "fixed_amount";
  discountValue: string | number;
  eligibleCustomerType: "distributor" | "retailer" | "wholesaler" | "all";
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type DiscountResolution = {
  discountAmount: number;
  ruleId: string | null;
  ruleType: "carton_equivalent" | "percentage" | "fixed_amount" | null;
  appliedThreshold: number | null;
};

/**
 * Checks if a discount rule is currently active based on date range
 * 
 * **Validates: Requirements 2.6, 2.7**
 * 
 * A rule is active if:
 * - Current date >= effectiveFrom, AND
 * - (effectiveTo is null OR current date <= effectiveTo)
 * 
 * @param rule - The customer discount rule to check
 * @param currentDate - The date to check against (defaults to now)
 * @returns true if the rule is active, false otherwise
 */
export function isRuleActive(
  rule: Pick<CustomerDiscountRule, "effectiveFrom" | "effectiveTo">,
  currentDate: Date = new Date()
): boolean {
  return (
    currentDate >= rule.effectiveFrom &&
    (rule.effectiveTo === null || currentDate <= rule.effectiveTo)
  );
}

/**
 * Checks if the purchase volume meets the rule's threshold
 * 
 * **Validates: Requirements 3.1**
 * 
 * @param rule - The customer discount rule with volumeThreshold
 * @param numberOfCartons - The number of cartons being purchased
 * @returns true if the volume threshold is met or exceeded
 */
export function meetsVolumeThreshold(
  rule: Pick<CustomerDiscountRule, "volumeThreshold">,
  numberOfCartons: number
): boolean {
  return numberOfCartons >= rule.volumeThreshold;
}

/**
 * Checks if the customer type is eligible for the discount rule
 * 
 * **Validates: Requirements 4.2, 4.3**
 * 
 * A customer is eligible if:
 * - eligibleCustomerType is "all", OR
 * - eligibleCustomerType matches the customer's customerType
 * 
 * @param rule - The customer discount rule with eligibleCustomerType
 * @param customerType - The customer's type (distributor, retailer, wholesaler)
 * @returns true if the customer type is eligible
 */
export function isCustomerTypeEligible(
  rule: Pick<CustomerDiscountRule, "eligibleCustomerType">,
  customerType: string
): boolean {
  return rule.eligibleCustomerType === "all" || rule.eligibleCustomerType === customerType;
}

/**
 * Selects the applicable rule with the highest volume threshold
 * 
 * **Validates: Requirements 3.2**
 * 
 * From a list of eligible rules, selects the one with the highest volumeThreshold
 * that is met or exceeded by the purchase quantity.
 * 
 * @param rules - Array of eligible customer discount rules
 * @param numberOfCartons - The number of cartons being purchased
 * @returns The rule with the highest applicable threshold, or null if none apply
 */
export function selectApplicableRule<T extends Pick<CustomerDiscountRule, "volumeThreshold">>(
  rules: T[],
  numberOfCartons: number
): T | null {
  const applicableRules = rules.filter(rule => numberOfCartons >= rule.volumeThreshold);
  
  if (applicableRules.length === 0) {
    return null;
  }
  
  return applicableRules.reduce((highest, current) =>
    current.volumeThreshold > highest.volumeThreshold ? current : highest
  );
}

/**
 * Evaluates customer discount rules and returns the applicable discount
 * 
 * Algorithm:
 * 1. Filter rules by customerId, productId, customerType eligibility, and volume threshold
 * 2. Select the rule with the highest volumeThreshold that is met or exceeded
 * 3. Calculate discount based on the rule's discountType
 * 4. Return discount amount and metadata
 * 
 * @param customerId - The customer ID
 * @param productId - The product ID
 * @param numberOfCartons - The number of cartons being purchased
 * @param perCartonPrice - The price per carton (after price agreement resolution)
 * @param customerType - The customer's type (distributor, retailer, wholesaler)
 * @param rules - Array of active customer discount rules
 * @returns DiscountResolution with discount amount and metadata
 */
export function evaluateCustomerDiscount(
  customerId: string,
  productId: string,
  numberOfCartons: number,
  perCartonPrice: number,
  customerType: string,
  rules: CustomerDiscountRule[]
): DiscountResolution {
  // Filter eligible rules using helper functions
  const eligibleRules = rules.filter(rule => 
    rule.customerId === customerId &&
    rule.productId === productId &&
    isRuleActive(rule) &&
    isCustomerTypeEligible(rule, customerType) &&
    meetsVolumeThreshold(rule, numberOfCartons)
  );

  // Select rule with highest threshold using helper function
  const applicableRule = selectApplicableRule(eligibleRules, numberOfCartons);

  if (!applicableRule) {
    return {
      discountAmount: 0,
      ruleId: null,
      ruleType: null,
      appliedThreshold: null
    };
  }

  const discountValue = Number(applicableRule.discountValue);
  let discountAmount = 0;

  switch (applicableRule.discountType) {
    case "carton_equivalent":
      discountAmount = discountValue * perCartonPrice;
      break;
    case "percentage":
      const baseAmount = numberOfCartons * perCartonPrice;
      discountAmount = (baseAmount * discountValue) / 100;
      break;
    case "fixed_amount":
      discountAmount = discountValue;
      break;
  }

  return {
    discountAmount: Math.max(0, discountAmount),
    ruleId: applicableRule.id,
    ruleType: applicableRule.discountType,
    appliedThreshold: applicableRule.volumeThreshold
  };
}
