import { createServerFn } from "@tanstack/react-start";
import { count, desc, eq, and, or, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, productionRuns, chemicals, packagingMaterials } from "@/db";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";

export const getPaginatedProductionRunsFn = createServerFn()
  .middleware([requireManufacturingViewMiddleware])
  .inputValidator(
    z.object({
      search: z.string().optional(),
      dateFilter: z.string().optional(),
      statusFilter: z.string().optional(),
      pageIndex: z.number().default(0),
      pageSize: z.number().default(10),
    })
  )
  .handler(async ({ data }) => {
    const whereConditions: SQL[] = [];

    // Search Box (Batch ID or Recipe Name)
    if (data.search) {
      const searchCondition = or(
        ilike(productionRuns.batchId, `%${data.search}%`),
        ilike(productionRuns.batchId, `%${data.search}%`),
      );
      if (searchCondition) {
        whereConditions.push(searchCondition);
      }
    }

    // Status Filter
    if (data.statusFilter && data.statusFilter !== "all") {
      whereConditions.push(eq(productionRuns.status, data.statusFilter as any));
    }

    // Date Filter (simple Postgres approximations using raw SQL)
    if (data.dateFilter && data.dateFilter !== "all") {
      if (data.dateFilter === "today") {
        whereConditions.push(sql`date(${productionRuns.createdAt}) = current_date`);
      } else if (data.dateFilter === "last_7_days") {
        whereConditions.push(sql`${productionRuns.createdAt} >= current_date - interval '7 days'`);
      } else if (data.dateFilter === "this_month") {
        whereConditions.push(sql`date_trunc('month', ${productionRuns.createdAt}) = date_trunc('month', current_date)`);
      }
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Fetch Total Count for Pagination
    const [totalCountResult] = await db
      .select({ value: count() })
      .from(productionRuns)
      .where(whereClause);
      
    const totalCount = totalCountResult?.value || 0;

    // Fetch Aggregated Metrics
    const [metricsResult] = await db
      .select({
        activeRuns: sql<number>`COALESCE(SUM(CASE WHEN ${productionRuns.status} = 'in_progress' THEN 1 ELSE 0 END), 0)::int`,
        totalCost: sql<number>`COALESCE(SUM(CASE WHEN ${productionRuns.status} = 'completed' THEN CAST(${productionRuns.totalProductionCost} AS NUMERIC) ELSE 0 END), 0)::numeric`,
        packsProduced: sql<number>`COALESCE(SUM(CASE WHEN ${productionRuns.status} = 'completed' THEN ${productionRuns.completedUnits} ELSE 0 END), 0)::int`,
      })
      .from(productionRuns)
      .where(whereClause);

    // Fetch Paginated Data
    const runs = await db.query.productionRuns.findMany({
      where: whereClause,
      orderBy: [desc(productionRuns.createdAt)],
      limit: data.pageSize,
      offset: data.pageIndex * data.pageSize,
      with: {
        recipe: {
          with: {
            product: true,
            ingredients: {
              with: {
                chemical: true,
              },
            },
            packaging: {
              with: {
                packagingMaterial: true,
              },
            },
            containerPackaging: true,
            cartonPackaging: true,
          },
        },
        warehouse: true,
        operator: true,
        materialsUsed: true,
      },
    });

    // Fetch all materials to map names
    const allChemicals = await db
      .select({ id: chemicals.id, name: chemicals.name })
      .from(chemicals);
    const allPackaging = await db
      .select({ id: packagingMaterials.id, name: packagingMaterials.name })
      .from(packagingMaterials);

    const chemicalMap = new Map(allChemicals.map((c) => [c.id, c.name]));
    const packagingMap = new Map(allPackaging.map((p) => [p.id, p.name]));

    // Enrich materialsUsed with names
    const enrichedRuns = runs.map((run) => ({
      ...run,
      materialsUsed:
        run.materialsUsed?.map((mu) => ({
          ...mu,
          materialName:
            mu.materialType === "chemical"
              ? chemicalMap.get(mu.materialId) || "Unknown Chemical"
              : packagingMap.get(mu.materialId) || "Unknown Packaging",
        })) || [],
    }));

    return {
      runs: enrichedRuns,
      totalCount,
      metrics: {
        activeRuns: metricsResult?.activeRuns || 0,
        totalCost: metricsResult?.totalCost || 0,
        packsProduced: metricsResult?.packsProduced || 0,
      }
    };
  });
