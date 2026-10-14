import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { recipes } from "@/db/schemas/inventory-schema";
import {
  mixingRuns,
  packagingAllocations,
} from "@/db/schemas/production-schema";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import {
  productionDateBounds,
  productionDateFields,
  validateProductionDateRange,
} from "@/lib/production/list-filters";

export const getPaginatedPackagingAllocationsFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .inputValidator(
    z
      .object({
        pageIndex: z.number().int().nonnegative().default(0),
        pageSize: z.number().int().positive().max(100).default(10),
        search: z.string().optional(),
        status: z
          .enum(["allocated", "in_progress", "completed", "cancelled"])
          .optional(),
        ...productionDateFields,
      })
      .superRefine(validateProductionDateRange),
  )
  .handler(async ({ data, context }) => {
    const conditions: SQL[] = [];
    if (data.search)
      conditions.push(
        or(
          ilike(packagingAllocations.id, `%${data.search}%`),
          ilike(mixingRuns.batchId, `%${data.search}%`),
          ilike(recipes.name, `%${data.search}%`),
        )!,
      );
    if (data.status)
      conditions.push(eq(packagingAllocations.status, data.status));
    const dates = productionDateBounds(data);
    if (dates.from)
      conditions.push(gte(packagingAllocations.createdAt, dates.from));
    if (dates.to) conditions.push(lt(packagingAllocations.createdAt, dates.to));
    if (
      !hasPermission(
        context.authContext.permissions,
        "manufacturing.run.manage",
      ) &&
      !hasPermission(
        context.authContext.permissions,
        "manufacturing.run.read",
      ) &&
      !hasPermission(context.authContext.permissions, "manufacturing.view")
    ) {
      conditions.push(
        eq(packagingAllocations.operatorId, context.session.user.id),
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [aggregate] = await db
      .select({
        count: sql<number>`count(*)`,
        scheduled: sql<number>`count(*) filter (where ${packagingAllocations.status} = 'allocated')`,
        active: sql<number>`count(*) filter (where ${packagingAllocations.status} = 'in_progress')`,
        completedContainers: sql<number>`coalesce(sum(${packagingAllocations.completedContainers}) filter (where ${packagingAllocations.status} <> 'cancelled'), 0)`,
        targetContainers: sql<number>`coalesce(sum(${packagingAllocations.targetContainers}) filter (where ${packagingAllocations.status} <> 'cancelled'), 0)`,
      })
      .from(packagingAllocations)
      .innerJoin(
        mixingRuns,
        eq(packagingAllocations.mixingRunId, mixingRuns.id),
      )
      .innerJoin(recipes, eq(packagingAllocations.recipeId, recipes.id))
      .where(where);
    const rows = await db
      .select({
        allocation: packagingAllocations,
        mixingRun: mixingRuns,
        recipe: recipes,
      })
      .from(packagingAllocations)
      .innerJoin(
        mixingRuns,
        eq(packagingAllocations.mixingRunId, mixingRuns.id),
      )
      .innerJoin(recipes, eq(packagingAllocations.recipeId, recipes.id))
      .where(where)
      .orderBy(
        desc(packagingAllocations.createdAt),
        desc(packagingAllocations.id),
      )
      .limit(data.pageSize)
      .offset(data.pageIndex * data.pageSize);
    const completedContainers = Number(aggregate.completedContainers);
    const targetContainers = Number(aggregate.targetContainers);
    return {
      allocations: rows.map(({ allocation, mixingRun, recipe }) => ({
        ...allocation,
        mixingRun,
        recipe,
      })),
      totalCount: Number(aggregate.count),
      kpis: {
        scheduled: Number(aggregate.scheduled),
        active: Number(aggregate.active),
        completedContainers,
        targetContainers,
        packingPercentage: targetContainers
          ? (completedContainers / targetContainers) * 100
          : 0,
      },
    };
  });
