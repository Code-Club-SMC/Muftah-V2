import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chemicals, inventoryAuditLog, materialLots } from "@/db/schemas/inventory-schema";
import { mixingMaterialUse, mixingMaterialsUsed, mixingRuns } from "@/db/schemas/production-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { checkLotPicks, costLotPicks, lotPickSchema } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock, takeLotPicks, type Tx } from "@/lib/inventory/material-lots.server";
import { MIXING_REASONS, checkReason, groupFormulaUse, mixingUseChange, reasonCodes } from "@/lib/production/material-use";

export const mixingUseSchema = z.object({
  chemicalId: z.string().min(1),
  used: z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, "Use a number with up to 3 decimals"),
  picks: z.array(lotPickSchema).max(50).default([]),
  reason: z.enum(reasonCodes(MIXING_REASONS)).optional(),
  note: z.string().trim().max(500).optional(),
});
export type MixingUseInput = z.infer<typeof mixingUseSchema>;

export async function completeMixingRunCore(
  tx: Tx,
  mixingRunId: string,
  userId: string,
  userName: string,
  input: { shortfallReason?: string; shortfallNote?: string; uses?: MixingUseInput[] } = {},
) {
  const [mixingRun] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, mixingRunId)).for("update");
  if (!mixingRun) throw new Error("Mixing batch not found");
  if (mixingRun.status !== "in_progress") throw new Error("Only mixing batches in progress can be completed");

  const output = new Big(mixingRun.actualBulkProduced ?? 0);
  const target = new Big(mixingRun.targetBulkQuantity);
  if (output.lte(0)) throw new Error("A mixing batch with zero output must be marked failed");
  if (output.gt(target)) throw new Error("Mixing output exceeds the target");
  const shortfall = target.minus(output);
  if (shortfall.gt(0)) {
    if (!input.shortfallReason) throw new Error("A shortfall reason is required before completing below target");
    const error = checkReason(MIXING_REASONS, input.shortfallReason, input.shortfallNote, "completing below target");
    if (error) throw new Error(error);
  }

  // What the batch took at start, per chemical, with the lots it came from.
  const formulaRows = await tx
    .select({ chemicalId: mixingMaterialsUsed.chemicalId, lotId: mixingMaterialsUsed.lotId, quantity: mixingMaterialsUsed.quantityUsed, unitPrice: mixingMaterialsUsed.costPerUnit, firstPurchasedAt: materialLots.firstPurchasedAt })
    .from(mixingMaterialsUsed)
    .innerJoin(materialLots, eq(materialLots.id, mixingMaterialsUsed.lotId))
    .where(and(eq(mixingMaterialsUsed.mixingRunId, mixingRun.id), eq(mixingMaterialsUsed.useType, "formula")))
    .orderBy(mixingMaterialsUsed.createdAt, mixingMaterialsUsed.id);
  const planned = groupFormulaUse(formulaRows.map((row) => ({ ...row, lotId: row.lotId! })));
  const uses = input.uses ?? [];
  if (uses.some((use) => !planned.has(use.chemicalId))) throw new Error("Actual use was entered for a chemical that is not in this batch");
  if (new Set(uses.map((use) => use.chemicalId)).size !== uses.length) throw new Error("Enter each chemical's use only once");
  const chemicalRows = planned.size
    ? await tx.select({ id: chemicals.id, name: chemicals.name, unit: chemicals.unit }).from(chemicals).where(inArray(chemicals.id, [...planned.keys()]))
    : [];
  await lockMaterialStock(tx, [mixingRun.warehouseId], [...planned.keys()].map((materialId) => ({ materialType: "chemical" as const, materialId })));

  for (const [chemicalId, plan] of [...planned].sort(([a], [b]) => a.localeCompare(b))) {
    const chemical = chemicalRows.find((row) => row.id === chemicalId);
    if (!chemical) throw new Error("Chemical not found");
    const ref = { materialType: "chemical" as const, materialId: chemicalId };
    const use = uses.find((row) => row.chemicalId === chemicalId);
    const change = mixingUseChange(plan.formula, use?.used ?? plan.formula);
    let extraCost = new Big(0);
    if (change.kind === "extra") {
      const error = checkReason(MIXING_REASONS, use?.reason, use?.note, `extra ${chemical.name}`);
      if (error) throw new Error(error);
      const picked = await takeLotPicks(tx, { warehouseId: mixingRun.warehouseId, ref, name: chemical.name, unit: chemical.unit, required: change.quantity, picks: use!.picks, sourceType: "mixing", sourceId: mixingRun.id, oldestFirst: true });
      for (const row of picked) {
        extraCost = extraCost.plus(row.totalCost);
        await tx.insert(mixingMaterialsUsed).values({ mixingRunId: mixingRun.id, chemicalId, lotId: row.lotId, quantityUsed: row.quantity, costPerUnit: row.unitPrice, totalCost: row.totalCost, useType: "extra" });
        await tx.insert(inventoryAuditLog).values({ warehouseId: mixingRun.warehouseId, materialType: "chemical", materialId: chemicalId, lotId: row.lotId, type: "debit", amount: row.quantity, reason: `Mixing batch ${mixingRun.batchId} used more than formula`, performedById: userId, referenceId: mixingRun.id });
      }
    } else if (change.kind === "leftover") {
      const picks = use?.picks ?? [];
      const errors = checkLotPicks({ name: chemical.name, unit: chemical.unit, required: change.quantity, picks, balances: plan.takenLots });
      if (errors.length) throw new Error(errors.join("; "));
      for (const row of costLotPicks(picks, plan.takenLots)) {
        extraCost = extraCost.minus(row.totalCost);
        await moveLotStock(tx, { ref, lotId: row.lotId, warehouseId: mixingRun.warehouseId, delta: row.quantity, sourceType: "mixing_return", sourceId: mixingRun.id });
        await tx.insert(mixingMaterialsUsed).values({ mixingRunId: mixingRun.id, chemicalId, lotId: row.lotId, quantityUsed: `-${row.quantity}`, costPerUnit: row.unitPrice, totalCost: `-${row.totalCost}`, useType: "returned" });
        await tx.insert(inventoryAuditLog).values({ warehouseId: mixingRun.warehouseId, materialType: "chemical", materialId: chemicalId, lotId: row.lotId, type: "credit", amount: row.quantity, reason: `Mixing batch ${mixingRun.batchId} leftover returned`, performedById: userId, referenceId: mixingRun.id });
      }
    }
    const used = new Big(use?.used ?? plan.formula);
    await tx.insert(mixingMaterialUse).values({
      mixingRunId: mixingRun.id, chemicalId, formulaQuantity: plan.formula, usedQuantity: used.toFixed(3),
      extraQuantity: used.minus(plan.formula).toFixed(3), extraCost: extraCost.toFixed(2),
      reason: change.kind === "extra" ? use!.reason! : null, note: change.kind === "extra" ? use?.note || null : null,
    });
  }

  const [{ total }] = await tx.select({ total: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)` }).from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, mixingRun.id));
  const totalChemicalCost = new Big(total);
  const yieldPercentage = output.div(target).times(100);
  await tx.update(mixingRuns).set({
    status: "completed",
    actualCompletionDate: new Date(),
    closedBy: userId,
    yieldPercentage: yieldPercentage.toFixed(2),
    shortfallQuantity: shortfall.toFixed(3),
    shortfallReasonCode: shortfall.gt(0) ? input.shortfallReason! : null,
    shortfallReason: shortfall.gt(0) ? input.shortfallNote?.trim() || null : null,
    totalChemicalCost: totalChemicalCost.toFixed(2),
    chemicalCostPerUnit: totalChemicalCost.div(output).toFixed(4),
  }).where(eq(mixingRuns.id, mixingRunId));

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
