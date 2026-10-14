import { eq } from "drizzle-orm";
import { mixingRuns } from "@/db/schemas/production-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import type { db } from "@/db";

type ProductionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function completeMixingRunCore(
  tx: ProductionTx,
  mixingRunId: string,
  userId: string,
  userName: string,
  shortfallReason?: string,
) {
  const [mixingRun] = await tx
    .select()
    .from(mixingRuns)
    .where(eq(mixingRuns.id, mixingRunId))
    .for("update");

  if (!mixingRun) throw new Error("Mixing batch not found");
  if (mixingRun.status !== "in_progress") {
    throw new Error("Only mixing batches in progress can be completed");
  }

  const actualBulkProduced = parseFloat(mixingRun.actualBulkProduced?.toString() || "0");
  const targetBulkQuantity = parseFloat(mixingRun.targetBulkQuantity.toString());
  const totalChemicalCost = parseFloat(mixingRun.totalChemicalCost?.toString() || "0");
  if (actualBulkProduced <= 0) throw new Error("A mixing batch with zero output must be marked failed");
  if (actualBulkProduced > targetBulkQuantity) throw new Error("Mixing output exceeds the target");

  let yieldPercentage = 0;
  if (targetBulkQuantity > 0) {
    yieldPercentage = (actualBulkProduced / targetBulkQuantity) * 100;
  }

  let shortfallQuantity = 0;
  if (actualBulkProduced < targetBulkQuantity) {
    shortfallQuantity = targetBulkQuantity - actualBulkProduced;
    if (!shortfallReason?.trim()) {
      throw new Error("A shortfall reason is required before completing below target");
    }
  }

  let chemicalCostPerUnit = 0;
  if (actualBulkProduced > 0) {
    chemicalCostPerUnit = totalChemicalCost / actualBulkProduced;
  }

  await tx
    .update(mixingRuns)
    .set({
      status: "completed",
      actualCompletionDate: new Date(),
      closedBy: userId,
      yieldPercentage: yieldPercentage.toFixed(2),
      shortfallQuantity: shortfallQuantity.toFixed(3),
      shortfallReason: shortfallQuantity > 0 ? shortfallReason!.trim() : null,
      chemicalCostPerUnit: chemicalCostPerUnit.toFixed(4),
    })
    .where(eq(mixingRuns.id, mixingRunId));

  logActivityQuiet({
    module: "manufacturing",
    action: "updated",
    entityType: "mixing_run",
    entityLabel: mixingRun.batchId,
    actorId: userId,
    actorName: userName,
    description: `Completed mixing batch ${mixingRun.batchId}. Yield: ${yieldPercentage.toFixed(2)}%`,
  });
}
