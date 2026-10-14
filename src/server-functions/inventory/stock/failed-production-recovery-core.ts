import Big from "big.js";
import { and, eq, sql } from "drizzle-orm";
import {
  chemicals,
  db,
  failedProductionChemicalRecoveries,
  materialStock,
  mixingRuns,
} from "@/db";

export type InventoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

export function hasOperatorProductionLogs(run: {
  actualBulkProduced: string | null;
  progressLogs?: Array<{ id: string }> | null;
}) {
  return (
    Number(run.actualBulkProduced ?? 0) > 0 ||
    (run.progressLogs?.length ?? 0) > 0
  );
}

export async function loadFailedProductionRecoveryContext(
  tx: InventoryTx,
  input: {
    batchId: string;
    chemicalId: string;
  },
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.batchId.trim()}), hashtext(${input.chemicalId}))`);

  const run = await tx.query.mixingRuns.findFirst({
    where: and(
      eq(mixingRuns.batchId, input.batchId.trim()),
      eq(mixingRuns.status, "failed"),
    ),
    with: {
      formula: {
        with: {
          product: true,
        },
      },
      materialsUsed: true,
      progressLogs: true,
      warehouse: true,
    },
  });

  if (!run) {
    throw new Error("Failed mixing batch not found.");
  }

  const factoryFloor = run.warehouse;
  if (factoryFloor.type !== "factory_floor") throw new Error("Mixing warehouse is not a factory floor");

  if (hasOperatorProductionLogs(run)) {
    throw new Error(
      "This batch already has operator production logs. Recover failed chemicals only for failed runs with zero logged output.",
    );
  }

  const chemical = await tx.query.chemicals.findFirst({
    where: eq(chemicals.id, input.chemicalId),
  });

  if (!chemical) {
    throw new Error("Chemical not found.");
  }

  const usages = run.materialsUsed.filter(row => row.chemicalId === input.chemicalId);
  const chemicalUsage = usages[0];

  if (!chemicalUsage) {
    throw new Error("This chemical was not deducted for the selected failed batch.");
  }
  const expectedQuantity = usages.reduce((sum, row) => sum.plus(row.quantityUsed), new Big(0)).toNumber();
  const totalCost = usages.reduce((sum, row) => sum.plus(row.totalCost), new Big(0)).toNumber();
  if (expectedQuantity <= 0) throw new Error("Chemical deduction must be positive");

  const settlement = await tx.query.failedProductionChemicalRecoveries.findFirst({
    where: and(
      eq(failedProductionChemicalRecoveries.mixingRunId, run.id),
      eq(failedProductionChemicalRecoveries.chemicalId, input.chemicalId),
    ),
  });

  const currentStock = await tx.query.materialStock.findFirst({
    where: and(
      eq(materialStock.warehouseId, factoryFloor.id),
      eq(materialStock.chemicalId, input.chemicalId),
    ),
  });

  return {
    factoryFloor,
    run,
    chemical,
    chemicalUsage,
    settlement,
    currentStock,
    expectedQuantity,
    costPerUnit: totalCost / expectedQuantity,
    currentStockQty: toNumber(currentStock?.quantity),
  };
}

export function calculateRecoveryLoss(input: {
  expectedQuantity: number;
  recoveredQuantity: number;
  costPerUnit: number;
}) {
  const difference = new Big(input.expectedQuantity).minus(input.recoveredQuantity);
  const lossQuantity = difference.gt(0) ? difference.toNumber() : 0;
  const lossAmount = Number(new Big(lossQuantity).times(input.costPerUnit).toFixed(2));

  return {
    lossQuantity,
    lossAmount,
  };
}
