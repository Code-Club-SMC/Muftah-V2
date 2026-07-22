/**
 * Distributor discount rules.
 * Supported shape: recipe-specific free-units only.
 */

import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { discountRules } from "@/db/schemas/sales-erp-schema";
import { customers } from "@/db/schemas/sales-schema";
import { recipes } from "@/db/schemas/inventory-schema";
import { requireSalesViewMiddleware, requireSalesManageMiddleware } from "@/lib/middlewares";
import { getApplicableDistributorFreeCartons } from "@/lib/sales/distributor-discount-rules";
import { z } from "zod";
import { eq, and, gte, lte, desc, or, isNull } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// CREATE DISCOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════
export const createDiscountRuleFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z.object({
      customerId: z.string().min(1),
      recipeId: z.string().min(1),
      ruleType: z.literal("free_units").default("free_units"),
      quantityThreshold: z.number().int().positive(),
      freeUnits: z.number().int().positive(),
      effectiveFrom: z.string().optional(),
      effectiveTo: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
    });
    if (!customer) throw new Error("Distributor not found");

    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, data.recipeId),
    });
    if (!recipe) throw new Error("Recipe not found");

    const [newRule] = await db
      .insert(discountRules)
      .values({
        customerId: data.customerId,
        recipeId: data.recipeId,
        ruleType: "free_units",
        quantityThreshold: data.quantityThreshold,
        freeUnits: data.freeUnits,
        discountCartons: 0,
        discountPercent: "0",
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
        isActive: true,
      })
      .returning();

    return newRule;
  });

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE DISCOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════
export const updateDiscountRuleFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z.object({
      id: z.string().min(1),
      quantityThreshold: z.number().int().positive().optional(),
      freeUnits: z.number().int().positive().optional(),
      effectiveFrom: z.string().optional(),
      effectiveTo: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const existing = await db.query.discountRules.findFirst({
      where: eq(discountRules.id, data.id),
    });
    if (!existing) throw new Error("Discount rule not found");

    const updateData: any = {};
    if (data.quantityThreshold !== undefined) updateData.quantityThreshold = data.quantityThreshold;
    if (data.freeUnits !== undefined) updateData.freeUnits = data.freeUnits;
    if (data.effectiveFrom !== undefined) updateData.effectiveFrom = new Date(data.effectiveFrom);
    if (data.effectiveTo !== undefined) updateData.effectiveTo = data.effectiveTo ? new Date(data.effectiveTo) : null;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(discountRules)
      .set(updateData)
      .where(eq(discountRules.id, data.id))
      .returning();

    return updated;
  });

// ═══════════════════════════════════════════════════════════════════════════
// DELETE DISCOUNT RULE
// ═══════════════════════════════════════════════════════════════════════════
export const deleteDiscountRuleFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    await db.delete(discountRules).where(eq(discountRules.id, data.id));
    return { success: true };
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET DISCOUNT RULES
// ═══════════════════════════════════════════════════════════════════════════
export const getDiscountRulesFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      customerId: z.string().optional(),
      recipeId: z.string().optional(),
      ruleType: z.literal("free_units").optional(),
      includeInactive: z.boolean().default(false),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [];

    if (data.customerId) {
      conditions.push(eq(discountRules.customerId, data.customerId));
    }
    if (data.recipeId) {
      conditions.push(eq(discountRules.recipeId, data.recipeId));
    }
    if (data.ruleType) {
      conditions.push(eq(discountRules.ruleType, data.ruleType));
    }
    if (!data.ruleType) {
      conditions.push(eq(discountRules.ruleType, "free_units"));
    }
    if (!data.includeInactive) {
      conditions.push(eq(discountRules.isActive, true));
      const now = new Date();
      conditions.push(
        and(
          lte(discountRules.effectiveFrom, now),
          or(
            isNull(discountRules.effectiveTo),
            gte(discountRules.effectiveTo, now),
          ),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await db.query.discountRules.findMany({
      where: whereClause,
      with: {
        customer: { columns: { id: true, name: true, customerType: true } },
        recipe: { columns: { id: true, name: true } },
      },
      orderBy: [desc(discountRules.quantityThreshold)],
    });
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET APPLICABLE DISCOUNT FOR INVOICE ITEM
// Returns supported distributor rule resolution for one recipe line.
// ═══════════════════════════════════════════════════════════════════════════
export const getApplicableDiscountFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      customerId: z.string(),
      recipeId: z.string(),
      quantity: z.number().int().nonnegative(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const now = new Date();

    const rules = await db.query.discountRules.findMany({
      where: and(
        eq(discountRules.customerId, data.customerId),
        eq(discountRules.recipeId, data.recipeId),
        eq(discountRules.ruleType, "free_units"),
        eq(discountRules.isActive, true),
        lte(discountRules.effectiveFrom, now),
        or(
          isNull(discountRules.effectiveTo),
          gte(discountRules.effectiveTo, now),
        ),
      ),
    });

    const resolution = getApplicableDistributorFreeCartons({
      rules,
      recipeId: data.recipeId,
      numberOfCartons: data.quantity,
    });

    if (!resolution.ruleId) {
      return { rules: [] };
    }

    const matchedRule = rules.find((rule) => rule.id === resolution.ruleId);
    if (!matchedRule) {
      return { rules: [] };
    }

    return {
      rules: [{
        rule: matchedRule,
        benefit: {
          type: "free_units" as const,
          freeUnits: resolution.freeCartons,
        },
      }],
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET ALL ACTIVE RULES FOR DISTRIBUTOR (bulk fetch for invoice creation)
// ═══════════════════════════════════════════════════════════════════════════
export const getDistributorDiscountRulesFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      customerId: z.string(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const now = new Date();

    return await db.query.discountRules.findMany({
      where: and(
        eq(discountRules.customerId, data.customerId),
        eq(discountRules.ruleType, "free_units"),
        eq(discountRules.isActive, true),
        lte(discountRules.effectiveFrom, now),
        or(
          isNull(discountRules.effectiveTo),
          gte(discountRules.effectiveTo, now),
        ),
      ),
      with: {
        recipe: { columns: { id: true, name: true } },
      },
    });
  });
