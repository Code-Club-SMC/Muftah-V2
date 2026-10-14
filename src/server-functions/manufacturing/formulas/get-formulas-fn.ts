import { createServerFn } from "@tanstack/react-start";
import {
  count,
  desc,
  eq,
  and,
  ilike,
  sql,
  gte,
  lt,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { formulas } from "@/db/schemas/production-schema";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";
import {
  productionDateFields,
  productionDateBounds,
  validateProductionDateRange,
} from "@/lib/production/list-filters";

export const getFormulasFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .inputValidator(
    z
      .object({
        search: z.string().optional(),
        productId: z.string().optional(),
        statusFilter: z.enum(["all", "active", "inactive"]).optional(),
        ...productionDateFields,
        pageIndex: z.number().int().nonnegative().default(0),
        pageSize: z.number().int().positive().max(100).default(10),
      })
      .superRefine(validateProductionDateRange),
  )
  .handler(async ({ data }) => {
    const whereConditions: SQL[] = [];

    // Search Box (Name)
    if (data.search) {
      whereConditions.push(ilike(formulas.name, `%${data.search}%`));
    }

    // Product Filter
    if (data.productId && data.productId !== "all") {
      whereConditions.push(eq(formulas.productId, data.productId));
    }

    // Status Filter
    if (data.statusFilter && data.statusFilter !== "all") {
      if (data.statusFilter === "active") {
        whereConditions.push(eq(formulas.isActive, true));
      } else if (data.statusFilter === "inactive") {
        whereConditions.push(eq(formulas.isActive, false));
      }
    }
    const dates = productionDateBounds(data);
    if (dates.from) whereConditions.push(gte(formulas.createdAt, dates.from));
    if (dates.to) whereConditions.push(lt(formulas.createdAt, dates.to));

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Fetch Total Count for Pagination
    const [totalCountResult] = await db
      .select({
        value: count(),
        active: sql<number>`count(*) filter (where ${formulas.isActive})`,
        inactive: sql<number>`count(*) filter (where not ${formulas.isActive})`,
        products: sql<number>`count(distinct ${formulas.productId})`,
      })
      .from(formulas)
      .where(whereClause);

    const totalCount = Number(totalCountResult?.value || 0);

    // Fetch Paginated Data
    const dataList = await db.query.formulas.findMany({
      where: whereClause,
      orderBy: [desc(formulas.createdAt), desc(formulas.id)],
      limit: data.pageSize,
      offset: data.pageIndex * data.pageSize,
      with: {
        product: true,
        ingredients: {
          with: {
            chemical: true,
          },
        },
      },
    });

    return {
      formulas: dataList,
      totalCount,
      kpis: {
        total: totalCount,
        active: Number(totalCountResult.active),
        inactive: Number(totalCountResult.inactive),
        products: Number(totalCountResult.products),
      },
    };
  });
