import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { discountRules as customerDiscountRules } from "@/db/schemas/sales-erp-schema";
import { customers } from "@/db/schemas/sales-schema";
import { products } from "@/db/schemas/inventory-schema";
import { requireSalesViewMiddleware, requireSalesManageMiddleware } from "@/lib/middlewares";
import { createCustomerDiscountRuleSchema, updateCustomerDiscountRuleSchema } from "@/db/zod_schemas";
import { z } from "zod";
import { eq, and, gte, lte, or, isNull, desc } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// CREATE CUSTOMER DISCOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════
export const createCustomerDiscountRuleFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => createCustomerDiscountRuleSchema.parse(input))
  .handler(async ({ data }) => {
    // Validate customer exists
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
    });

    if (!customer) {
      throw new Error("Customer not found");
    }

    // Validate product exists
    const product = await db.query.products.findFirst({
      where: eq(products.id, data.productId),
    });

    if (!product) {
      throw new Error("Product not found");
    }

    // Check for duplicate rule (same customer, product, and volume threshold)
    const existingRule = await db.query.discountRules.findFirst({
      where: and(
        eq(customerDiscountRules.customerId, data.customerId),
        eq(customerDiscountRules.recipeId, data.productId),
        eq(customerDiscountRules.quantityThreshold, data.volumeThreshold),
      ),
    });

    if (existingRule) {
      throw new Error("A discount rule with the same customer, product, and volume threshold already exists");
    }

    // Create the rule
    const [newRule] = await db
      .insert(customerDiscountRules)
      .values({
        customerId: data.customerId,
        recipeId: data.productId,
        quantityThreshold: data.volumeThreshold,
        ruleType: data.discountType as any,
        discountPercent: data.discountValue.toString(),
        // eligibleCustomerType removed
        effectiveFrom: data.effectiveFrom ?? new Date(),
        effectiveTo: data.effectiveTo ?? null,
      })
      .returning();

    return newRule;
  });

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE CUSTOMER DISCOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════
export const updateCustomerDiscountRuleFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => updateCustomerDiscountRuleSchema.parse(input))
  .handler(async ({ data }) => {
    const { id, ...updates } = data;

    // Check if rule exists
    const existingRule = await db.query.discountRules.findFirst({
      where: eq(customerDiscountRules.id, id),
    });

    if (!existingRule) {
      throw new Error("Discount rule not found");
    }

    // If updating customer, validate it exists
    if (updates.customerId) {
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, updates.customerId),
      });

      if (!customer) {
        throw new Error("Customer not found");
      }
    }

    // If updating product, validate it exists
    if (updates.productId) {
      const product = await db.query.products.findFirst({
        where: eq(products.id, updates.productId),
      });

      if (!product) {
        throw new Error("Product not found");
      }
    }

    // Check for duplicate if updating key fields
    if (updates.customerId || updates.productId || updates.volumeThreshold) {
      const checkCustomerId = updates.customerId ?? existingRule.customerId;
      const checkProductId = updates.productId ?? existingRule.recipeId;
      const checkVolumeThreshold = updates.volumeThreshold ?? existingRule.quantityThreshold;

      const duplicateRule = await db.query.discountRules.findFirst({
        where: and(
          eq(customerDiscountRules.customerId, checkCustomerId),
          checkProductId ? eq(customerDiscountRules.recipeId, checkProductId) : isNull(customerDiscountRules.recipeId),
          eq(customerDiscountRules.quantityThreshold, checkVolumeThreshold),
        ),
      });

      if (duplicateRule && duplicateRule.id !== id) {
        throw new Error("A discount rule with the same customer, product, and volume threshold already exists");
      }
    }

    // Prepare update values
    const updateValues: any = {};
    if (updates.customerId !== undefined) updateValues.customerId = updates.customerId;
    if (updates.productId !== undefined) updateValues.recipeId = updates.productId;
    if (updates.volumeThreshold !== undefined) updateValues.quantityThreshold = updates.volumeThreshold;
    if (updates.discountType !== undefined) updateValues.ruleType = updates.discountType;
    if (updates.discountValue !== undefined) updateValues.discountPercent = updates.discountValue.toString();
    // no eligibleCustomerType
    if (updates.effectiveFrom !== undefined) updateValues.effectiveFrom = updates.effectiveFrom;
    if (updates.effectiveTo !== undefined) updateValues.effectiveTo = updates.effectiveTo;

    // Update the rule
    const [updatedRule] = await db
      .update(customerDiscountRules)
      .set(updateValues)
      .where(eq(customerDiscountRules.id, id))
      .returning();

    return updatedRule;
  });

// ═══════════════════════════════════════════════════════════════════════════
// DEACTIVATE CUSTOMER DISCOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════
export const deactivateCustomerDiscountRuleFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    // Check if rule exists
    const existingRule = await db.query.discountRules.findFirst({
      where: eq(customerDiscountRules.id, data.id),
    });

    if (!existingRule) {
      throw new Error("Discount rule not found");
    }

    // Set effectiveTo to current date
    const [deactivatedRule] = await db
      .update(customerDiscountRules)
      .set({ effectiveTo: new Date() })
      .where(eq(customerDiscountRules.id, data.id))
      .returning();

    return deactivatedRule;
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET CUSTOMER DISCOUNT RULES
// ═══════════════════════════════════════════════════════════════════════════
export const getCustomerDiscountRulesFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      customerId: z.string().optional(),
      recipeId: z.string().optional(),
      includeInactive: z.boolean().default(false),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [];

    // Filter by customer if provided
    if (data.customerId) {
      conditions.push(eq(customerDiscountRules.customerId, data.customerId));
    }

    // Filter by product if provided
    if (data.recipeId) {
      conditions.push(eq(customerDiscountRules.recipeId, data.recipeId));
    }

    // Filter out inactive rules unless includeInactive is true
    if (!data.includeInactive) {
      const now = new Date();
      conditions.push(
        and(
          lte(customerDiscountRules.effectiveFrom, now),
          or(
            isNull(customerDiscountRules.effectiveTo),
            gte(customerDiscountRules.effectiveTo, now),
          ),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Query rules with related customer and product data
    const rules = await db.query.discountRules.findMany({
      where: whereClause,
      with: {
        customer: {
          columns: {
            id: true,
            name: true,
            customerType: true,
          },
        },
        product: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [desc(customerDiscountRules.quantityThreshold)],
    });

    return rules;
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET APPLICABLE DISCOUNT RULES (for invoice creation)
// ═══════════════════════════════════════════════════════════════════════════
export const getApplicableDiscountRulesFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      customerId: z.string(),
      recipeId: z.string(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    // Get customer to check customer type
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
    });

    if (!customer) {
      throw new Error("Customer not found");
    }

    const now = new Date();

    // Query active rules for this customer and product
    const rules = await db.query.discountRules.findMany({
      where: and(
        eq(customerDiscountRules.customerId, data.customerId),
        eq(customerDiscountRules.recipeId, data.recipeId),
        lte(customerDiscountRules.effectiveFrom, now),
        or(
          isNull(customerDiscountRules.effectiveTo),
          gte(customerDiscountRules.effectiveTo, now),
        ),
        or(
          eq(customerDiscountRules.ruleType, "all"),
          eq(customerDiscountRules.ruleType, customer.customerType),
        ),
      ),
      orderBy: [desc(customerDiscountRules.quantityThreshold)],
    });

    return rules;
  });
