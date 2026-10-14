import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { mixingRuns, formulas } from "@/db/schemas/production-schema";
import { user } from "@/db/schemas/auth-schema";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { desc, eq, ilike, and, sql, inArray, gte, lt } from "drizzle-orm";
import { z } from "zod";
import {
  productionDateFields,
  productionDateBounds,
  validateProductionDateRange,
} from "@/lib/production/list-filters";

const getMixingRunsSchema = z
  .object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(10),
    ...productionDateFields,
    search: z.string().optional(),
    status: z
      .enum(["scheduled", "in_progress", "completed", "cancelled", "failed"])
      .optional(),
    statuses: z
      .array(
        z.enum([
          "scheduled",
          "in_progress",
          "completed",
          "cancelled",
          "failed",
        ]),
      )
      .min(1)
      .optional(),
  })
  .superRefine(validateProductionDateRange);

export const getMixingRunsFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .inputValidator(getMixingRunsSchema)
  .handler(async ({ data, context }) => {
    const offset = (data.page - 1) * data.limit;

    const conditions = [];

    if (data.search) {
      conditions.push(ilike(mixingRuns.batchId, `%${data.search}%`));
    }

    if (data.status) {
      conditions.push(eq(mixingRuns.status, data.status));
    }
    if (data.statuses) {
      conditions.push(inArray(mixingRuns.status, data.statuses));
    }
    const dates = productionDateBounds(data);
    if (dates.from) conditions.push(gte(mixingRuns.createdAt, dates.from));
    if (dates.to) conditions.push(lt(mixingRuns.createdAt, dates.to));
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
      conditions.push(eq(mixingRuns.operatorId, context.session.user.id));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({
        count: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${mixingRuns.status} in ('scheduled', 'in_progress'))`,
        completed: sql<number>`count(*) filter (where ${mixingRuns.status} = 'completed')`,
        averageYield: sql<
          number | null
        >`avg(100.0 * ${mixingRuns.actualBulkProduced} / nullif(${mixingRuns.targetBulkQuantity}, 0)) filter (where ${mixingRuns.status} = 'completed')`,
      })
      .from(mixingRuns)
      .where(whereClause);

    const total = Number(countResult.count);
    const totalPages = Math.ceil(total / data.limit);

    const results = await db
      .select({
        mixingRun: mixingRuns,
        formula: formulas,
        operator: {
          id: user.id,
          name: user.name,
        },
      })
      .from(mixingRuns)
      .leftJoin(formulas, eq(mixingRuns.formulaId, formulas.id))
      .leftJoin(user, eq(mixingRuns.operatorId, user.id))
      .where(whereClause)
      .orderBy(desc(mixingRuns.createdAt), desc(mixingRuns.id))
      .limit(data.limit)
      .offset(offset);

    return {
      runs: results.map((r) => ({
        ...r.mixingRun,
        formulaName: r.formula?.name,
        operatorName: r.operator?.name,
      })),
      kpis: {
        total,
        active: Number(countResult.active),
        completed: Number(countResult.completed),
        completionPercentage: total
          ? (Number(countResult.completed) / total) * 100
          : 0,
        averageYieldPercentage:
          countResult.averageYield == null
            ? null
            : Number(countResult.averageYield),
      },
      pagination: {
        page: data.page,
        limit: data.limit,
        total,
        totalPages,
      },
    };
  });
