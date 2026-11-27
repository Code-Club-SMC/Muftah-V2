import Big from "big.js";
import { and, eq } from "drizzle-orm";
import {
  failedProductionChemicalRecoveries,
  inventoryAuditLog,
  materialStock,
} from "@/db";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { splitRecoveryAcrossLots, type LotPick } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { hasPermission } from "@/lib/rbac";
import {
  calculateRecoveryLoss,
  loadFailedProductionRecoveryContext,
  type InventoryTx,
} from "./failed-production-recovery-core";

export type SettlementActor = {
  id: string;
  name: string;
  permissions: Iterable<string>;
};

export type ChemicalSettlementInput = {
  batchId: string;
  chemicalId: string;
  recoveredQuantity: number;
  reason: string;
  lotReturns?: LotPick[];
};

export type ChemicalSettlementResult = Awaited<ReturnType<typeof settleFailedBatchChemical>>;

/**
 * Settle one chemical of a failed, zero-output mixing batch: put the recovered
 * amount back into the lots it came from and write the rest off as a loss.
 * Each chemical can be settled once per batch.
 */
export async function settleFailedBatchChemical(
  tx: InventoryTx,
  input: ChemicalSettlementInput,
  actor: SettlementActor,
) {
  const recovery = await loadFailedProductionRecoveryContext(tx, input);
  if (recovery.run.operatorId !== actor.id && !hasPermission(actor.permissions, "inventory.manage")) {
    throw new Error("This failed mixing run is assigned to another operator");
  }
  if (recovery.settlement) {
    throw new Error(`${recovery.chemical.name} has already been settled for batch ${recovery.run.batchId}.`);
  }
  if (input.recoveredQuantity > recovery.expectedQuantity) {
    throw new Error(
      `Recovered ${recovery.chemical.name} cannot exceed ${recovery.expectedQuantity.toFixed(3)} ${recovery.chemical.unit}.`,
    );
  }

  const reason = input.reason.trim();
  const { lossAmount, lossQuantity } = calculateRecoveryLoss({
    expectedQuantity: recovery.expectedQuantity,
    recoveredQuantity: input.recoveredQuantity,
    costPerUnit: recovery.costPerUnit,
  });

  let newQty = recovery.currentStockQty;

  if (input.recoveredQuantity > 0) {
    const ref = { materialType: "chemical", materialId: recovery.chemical.id } as const;
    await lockMaterialStock(tx, [recovery.factoryFloor.id], [ref]);
    const usages = recovery.lotUsages;
    if (usages.some(row => !row.lotId)) {
      throw new Error(
        `Batch ${recovery.run.batchId} was started before price lots, so ${recovery.chemical.name} can't be returned to stock. Settle it with 0 recovered or contact support.`,
      );
    }
    const recovered = new Big(input.recoveredQuantity).toFixed(3);
    const gaveByLot = new Map<string, Big>();
    for (const usage of usages) gaveByLot.set(usage.lotId!, (gaveByLot.get(usage.lotId!) ?? new Big(0)).plus(usage.quantityUsed));
    const returns = input.lotReturns ?? splitRecoveryAcrossLots(recovered, [...gaveByLot].map(([lotId, quantity]) => ({ lotId, quantity: quantity.toFixed(3), unitPrice: "0" })));
    const returned = returns.reduce((sum, row) => sum.plus(row.quantity), new Big(0));
    if (!returned.eq(recovered)) throw new Error("Lot returns must add up to the recovered quantity");
    if (new Set(returns.map(row => row.lotId)).size !== returns.length) throw new Error("Return to each lot only once");
    for (const row of returns) {
      if (new Big(row.quantity).gt(gaveByLot.get(row.lotId) ?? 0)) throw new Error("Lot returns can't be more than this batch took from that lot");
      const quantity = new Big(row.quantity).toFixed(3);
      await moveLotStock(tx, { ref, lotId: row.lotId, warehouseId: recovery.factoryFloor.id, delta: quantity, sourceType: "recovery", sourceId: recovery.run.id });
      await tx.insert(inventoryAuditLog).values({
        warehouseId: recovery.factoryFloor.id,
        materialType: "chemical",
        materialId: recovery.chemical.id,
        lotId: row.lotId,
        type: "credit",
        amount: quantity,
        reason:
          `[FAILED BATCH RECOVERY] Batch ${recovery.run.batchId} returned ` +
          `${quantity} ${recovery.chemical.unit} of ${recovery.chemical.name}. ${reason}`,
        performedById: actor.id,
        referenceId: recovery.run.id,
      });
    }
    const [total] = await tx.select({ quantity: materialStock.quantity }).from(materialStock)
      .where(and(eq(materialStock.warehouseId, recovery.factoryFloor.id), eq(materialStock.chemicalId, recovery.chemical.id)));
    newQty = Number(total?.quantity ?? 0);
  }

  if (lossQuantity > 0) {
    await tx.insert(inventoryAuditLog).values({
      warehouseId: recovery.factoryFloor.id,
      materialType: "chemical",
      materialId: recovery.chemical.id,
      type: "debit",
      amount: "0",
      reason:
        `[FAILED BATCH LOSS] Batch ${recovery.run.batchId} wrote off ` +
        `${lossQuantity.toFixed(3)} ${recovery.chemical.unit} of ${recovery.chemical.name} ` +
        `(${lossAmount.toFixed(2)} PKR). ${reason}`,
      performedById: actor.id,
      referenceId: recovery.run.id,
    });
  }

  await tx.insert(failedProductionChemicalRecoveries).values({
    mixingRunId: recovery.run.id,
    mixingMaterialUsedId: recovery.chemicalUsage.id,
    warehouseId: recovery.factoryFloor.id,
    chemicalId: recovery.chemical.id,
    expectedQuantity: recovery.expectedQuantity.toString(),
    recoveredQuantity: input.recoveredQuantity.toString(),
    lossQuantity: lossQuantity.toString(),
    costPerUnit: recovery.costPerUnit.toString(),
    lossAmount: lossAmount.toString(),
    notes: reason,
    settledById: actor.id,
  });

  return {
    success: true as const,
    mixingRunId: recovery.run.id,
    batchId: recovery.run.batchId,
    warehouseName: recovery.factoryFloor.name,
    chemicalId: recovery.chemical.id,
    chemicalName: recovery.chemical.name,
    chemicalUnit: recovery.chemical.unit,
    expectedQuantity: recovery.expectedQuantity,
    recoveredQuantity: input.recoveredQuantity,
    lossQuantity,
    lossAmount,
    newQty,
    reason,
  };
}

/**
 * Record one timeline entry per settled chemical. Call after the transaction
 * commits so the timeline never shows a settlement that was rolled back.
 */
export async function logChemicalSettlements(
  results: ChemicalSettlementResult[],
  actor: Pick<SettlementActor, "id" | "name">,
  source: "failed_batch_screen" | "stock_adjustment",
) {
  for (const result of results) {
    const unit = result.chemicalUnit;
    const returned = `${result.recoveredQuantity.toFixed(3)} ${unit}`;
    const lost = `${result.lossQuantity.toFixed(3)} ${unit}`;
    const prefix = `Settled ${result.chemicalName} for failed batch ${result.batchId}`;
    const loss = `wrote off ${lost} (PKR ${result.lossAmount.toFixed(2)})`;
    const description = result.lossQuantity <= 0
      ? `${prefix}: returned all ${returned} to stock`
      : result.recoveredQuantity > 0
        ? `${prefix}: returned ${returned} to stock, ${loss}`
        : `${prefix}: nothing returned, ${loss}`;

    await logActivityQuiet({
      module: "manufacturing",
      action: "chemical_recovered",
      entityType: "mixing_run",
      entityId: result.mixingRunId,
      entityLabel: result.batchId,
      actorId: actor.id,
      actorName: actor.name,
      description,
      metadata: {
        chemical: result.chemicalName,
        factoryFloor: result.warehouseName,
        takenByBatch: `${result.expectedQuantity.toFixed(3)} ${unit}`,
        returnedToStock: returned,
        writtenOff: lost,
        lossAmountPkr: result.lossAmount.toFixed(2),
        stockAfter: `${result.newQty.toFixed(3)} ${unit}`,
        reason: result.reason,
        settledFrom: source === "failed_batch_screen" ? "Failed batch screen" : "Stock adjustment",
      },
      severity: result.lossQuantity > 0 ? "warning" : "info",
    });
  }
}
