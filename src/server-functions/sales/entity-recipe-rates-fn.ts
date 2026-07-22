import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { entityRecipeRates } from "@/db/schemas/sales-erp-schema";
import { recipes } from "@/db/schemas/inventory-schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { GENERAL_RECIPE_RATE_ENTITY_ID } from "@/lib/sales/entity-recipe-rate-config";
import {
  requireSalesConfigViewMiddleware,
  requireSalesConfigManageMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY RECIPE RATES
// Polymorphic per-entity carton pricing for distributors, order bookers,
// and general walk-in invoices.
// entityType ∈ {'distributor', 'order_booker', 'general'}.
// ═══════════════════════════════════════════════════════════════════════════

const entityTypeSchema = z.enum(["distributor", "order_booker", "general"]);

export const getEntityRecipeRatesFn = createServerFn()
  .middleware([requireSalesConfigViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        entityType: entityTypeSchema.optional(),
        entityId: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const conditions: any[] = [];
    if (data.entityType) conditions.push(eq(entityRecipeRates.entityType, data.entityType));
    if (data.entityId) conditions.push(eq(entityRecipeRates.entityId, data.entityId));

    const rows = await db.query.entityRecipeRates.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        recipe: {
          columns: {
            id: true,
            name: true,
            containersPerCarton: true,
          },
          with: {
            product: { columns: { id: true, name: true } },
          },
        },
      },
      orderBy: [desc(entityRecipeRates.updatedAt)],
    });
    return rows;
  });

export const getEntityRecipeRatesForEntityFn = createServerFn()
  .middleware([requireSalesConfigViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        entityType: entityTypeSchema,
        entityId: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (data.entityType === "general" && data.entityId !== GENERAL_RECIPE_RATE_ENTITY_ID) {
      throw new Error(`General recipe rates must use entityId "${GENERAL_RECIPE_RATE_ENTITY_ID}".`);
    }

    return await db.query.entityRecipeRates.findMany({
      where: and(
        eq(entityRecipeRates.entityType, data.entityType),
        eq(entityRecipeRates.entityId, data.entityId),
      ),
      with: {
        recipe: {
          columns: {
            id: true,
            name: true,
            containersPerCarton: true,
          },
          with: {
            product: { columns: { id: true, name: true } },
          },
        },
      },
      orderBy: [desc(entityRecipeRates.updatedAt)],
    });
  });

// Lookup used by the order pad / invoice form to auto-populate rates.
// Returns a flat list of { recipeId, pricePerCarton, containersPerCarton }.
export const getRecipeRatesForEntityFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        entityType: entityTypeSchema,
        entityId: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (data.entityType === "general" && data.entityId !== GENERAL_RECIPE_RATE_ENTITY_ID) {
      throw new Error(`General recipe rates must use entityId "${GENERAL_RECIPE_RATE_ENTITY_ID}".`);
    }

    const rows = await db
      .select({
        recipeId: entityRecipeRates.recipeId,
        pricePerCarton: entityRecipeRates.pricePerCarton,
        containersPerCarton: recipes.containersPerCarton,
      })
      .from(entityRecipeRates)
      .innerJoin(recipes, eq(entityRecipeRates.recipeId, recipes.id))
      .where(
        and(
          eq(entityRecipeRates.entityType, data.entityType),
          eq(entityRecipeRates.entityId, data.entityId),
        ),
      );
    return rows.map((r) => ({
      recipeId: r.recipeId,
      pricePerCarton: Number(r.pricePerCarton),
      containersPerCarton: Number(r.containersPerCarton ?? 0),
    }));
  });

export const upsertEntityRecipeRateFn = createServerFn()
  .middleware([requireSalesConfigManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        entityType: entityTypeSchema,
        entityId: z.string().min(1),
        recipeId: z.string().min(1),
        pricePerCarton: z.number().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.entityType === "general" && data.entityId !== GENERAL_RECIPE_RATE_ENTITY_ID) {
      throw new Error(`General recipe rates must use entityId "${GENERAL_RECIPE_RATE_ENTITY_ID}".`);
    }

    const updatedById = context.authContext?.session?.user?.id ?? null;
    const existing = await db.query.entityRecipeRates.findFirst({
      where: and(
        eq(entityRecipeRates.entityType, data.entityType),
        eq(entityRecipeRates.entityId, data.entityId),
        eq(entityRecipeRates.recipeId, data.recipeId),
      ),
    });
    if (existing) {
      await db
        .update(entityRecipeRates)
        .set({
          pricePerCarton: data.pricePerCarton.toString(),
          updatedById,
          updatedAt: new Date(),
        })
        .where(eq(entityRecipeRates.id, existing.id));
      return { id: existing.id, created: false };
    }
    const id = createId();
    await db.insert(entityRecipeRates).values({
      id,
      entityType: data.entityType,
      entityId: data.entityId,
      recipeId: data.recipeId,
      pricePerCarton: data.pricePerCarton.toString(),
      updatedById,
    });
    return { id, created: true };
  });

export const deleteEntityRecipeRateFn = createServerFn()
  .middleware([requireSalesConfigManageMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    await db.delete(entityRecipeRates).where(eq(entityRecipeRates.id, data.id));
    return { success: true };
  });
