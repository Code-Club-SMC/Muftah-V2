import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, failedProductionChemicalRecoveries, mixingMaterialsUsed, mixingRuns, warehouses } from "@/db";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";

/**
 * Failed, zero-output mixing batches that still have chemicals nobody has
 * returned to stock or written off. Operators only see their own batches.
 */
export const getFailedBatchesToSettleFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .handler(async ({ context }) => {
    const permissions = context.authContext.permissions;
    const seesAllRuns =
      hasPermission(permissions, "manufacturing.run.manage") ||
      hasPermission(permissions, "manufacturing.run.read") ||
      hasPermission(permissions, "manufacturing.view");

    // Chemicals taken by the batch with no settlement row yet.
    const pendingChemicals = sql<number>`count(distinct ${mixingMaterialsUsed.chemicalId}) filter (where ${failedProductionChemicalRecoveries.id} is null)`;

    const rows = await db
      .select({
        mixingRunId: mixingRuns.id,
        batchId: mixingRuns.batchId,
        failedAt: mixingRuns.actualCompletionDate,
        factoryFloor: warehouses.name,
        pendingChemicals: pendingChemicals.mapWith(Number),
      })
      .from(mixingRuns)
      .innerJoin(warehouses, eq(warehouses.id, mixingRuns.warehouseId))
      .innerJoin(mixingMaterialsUsed, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
      .leftJoin(
        failedProductionChemicalRecoveries,
        and(
          eq(failedProductionChemicalRecoveries.mixingRunId, mixingRuns.id),
          eq(failedProductionChemicalRecoveries.chemicalId, mixingMaterialsUsed.chemicalId),
        ),
      )
      .where(and(
        eq(mixingRuns.status, "failed"),
        sql`coalesce(${mixingRuns.actualBulkProduced}, 0) = 0`,
        sql`not exists (select 1 from mixing_progress_logs l where l.mixing_run_id = ${mixingRuns.id})`,
        seesAllRuns ? undefined : eq(mixingRuns.operatorId, context.session.user.id),
      ))
      .groupBy(mixingRuns.id, warehouses.name)
      .having(sql`${pendingChemicals} > 0`)
      .orderBy(desc(mixingRuns.actualCompletionDate))
      .limit(50);

    return {
      batches: rows.map((row) => ({ ...row, failedAt: row.failedAt?.toISOString() ?? null })),
      total: rows.length,
    };
  });
