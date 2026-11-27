import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, failedProductionChemicalRecoveries } from "@/db";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";

/**
 * Chemicals a failed mixing batch took from stock, and which of them have
 * already been returned or written off.
 */
export const getFailedBatchSettlementFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .inputValidator(z.object({ mixingRunId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const permissions = context.authContext.permissions;
    const userId = context.session.user.id;

    const run = await db.query.mixingRuns.findFirst({
      where: (runs, { eq }) => eq(runs.id, data.mixingRunId),
      with: {
        warehouse: true,
        materialsUsed: { with: { chemical: true } },
        progressLogs: true,
      },
    });
    if (!run) throw new Error("Mixing batch not found");

    const isOwner = run.operatorId === userId;
    const seesAllRuns =
      hasPermission(permissions, "manufacturing.run.manage") ||
      hasPermission(permissions, "manufacturing.run.read") ||
      hasPermission(permissions, "manufacturing.view");
    if (!isOwner && !seesAllRuns) {
      throw new Error("This mixing batch is assigned to another operator");
    }
    if (run.status !== "failed") {
      return { applies: false as const };
    }

    const hasOutput = Number(run.actualBulkProduced ?? 0) > 0 || run.progressLogs.length > 0;
    const seesCosts = seesAllRuns;
    const canSettle =
      !hasOutput &&
      (hasPermission(permissions, "inventory.manage") ||
        (isOwner && hasPermission(permissions, "operator.run.fail")));

    const settlements = await db.query.failedProductionChemicalRecoveries.findMany({
      where: eq(failedProductionChemicalRecoveries.mixingRunId, run.id),
      with: { settledBy: true },
    });
    const settledByChemical = new Map(settlements.map((row) => [row.chemicalId, row]));

    const byChemical = new Map<string, {
      chemicalId: string;
      name: string;
      unit: string;
      taken: Big;
      cost: Big;
      startedBeforeLots: boolean;
    }>();
    for (const row of run.materialsUsed) {
      const entry = byChemical.get(row.chemicalId) ?? {
        chemicalId: row.chemicalId,
        name: row.chemical.name,
        unit: row.chemical.unit,
        taken: new Big(0),
        cost: new Big(0),
        startedBeforeLots: false,
      };
      entry.taken = entry.taken.plus(row.quantityUsed);
      entry.cost = entry.cost.plus(row.totalCost);
      if (!row.lotId) entry.startedBeforeLots = true;
      byChemical.set(row.chemicalId, entry);
    }

    const chemicals = [...byChemical.values()]
      .filter((entry) => entry.taken.gt(0))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const settled = settledByChemical.get(entry.chemicalId);
        return {
          chemicalId: entry.chemicalId,
          name: entry.name,
          unit: entry.unit,
          taken: Number(entry.taken.toFixed(3)),
          costPerUnit: seesCosts ? Number(entry.cost.div(entry.taken).toFixed(2)) : null,
          startedBeforeLots: entry.startedBeforeLots,
          settlement: settled
            ? {
                recovered: Number(settled.recoveredQuantity),
                lost: Number(settled.lossQuantity),
                lossAmount: seesCosts ? Number(settled.lossAmount) : null,
                notes: settled.notes,
                settledBy: settled.settledBy?.name ?? "Unknown user",
                settledAt: settled.createdAt.toISOString(),
              }
            : null,
        };
      });

    return {
      applies: true as const,
      mixingRunId: run.id,
      batchId: run.batchId,
      factoryFloor: run.warehouse.name,
      failedAt: run.actualCompletionDate?.toISOString() ?? null,
      failReason: run.shortfallReason,
      hasOutput,
      canSettle,
      seesCosts,
      chemicals,
      pendingCount: chemicals.filter((row) => !row.settlement).length,
    };
  });
