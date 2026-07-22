import { and, eq } from "drizzle-orm";
import {
  chemicals,
  db,
  failedProductionChemicalRecoveries,
  materialStock,
  productionRuns,
  warehouses,
} from "@/db";

export type InventoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

export function hasOperatorProductionLogs(run: {
  completedUnits: number | null;
  materialsUsed?: Array<{ materialType: string }> | null;
}) {
  return (
    (run.completedUnits ?? 0) > 0 ||
    (run.materialsUsed ?? []).some((row) => row.materialType === "packaging")
  );
}

export async function loadFailedProductionRecoveryContext(
  tx: InventoryTx,
  input: {
    batchId: string;
    chemicalId: string;
  },
) {
  const factoryFloor = await tx.query.warehouses.findFirst({
    where: eq(warehouses.type, "factory_floor"),
  });

  if (!factoryFloor) {
    throw new Error("Factory floor not found.");
  }

  const run = await tx.query.productionRuns.findFirst({
    where: and(
      eq(productionRuns.batchId, input.batchId.trim()),
      eq(productionRuns.status, "failed"),
    ),
    with: {
      recipe: {
        with: {
          product: true,
        },
      },
      materialsUsed: true,
    },
  });

  if (!run) {
    throw new Error("Failed production batch not found.");
  }

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

  const chemicalUsage = run.materialsUsed.find(
    (row) =>
      row.materialType === "chemical" && row.materialId === input.chemicalId,
  );

  if (!chemicalUsage) {
    throw new Error("This chemical was not deducted for the selected failed batch.");
  }

  const settlement = await tx.query.failedProductionChemicalRecoveries.findFirst({
    where: and(
      eq(failedProductionChemicalRecoveries.productionRunId, run.id),
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
    expectedQuantity: toNumber(chemicalUsage.quantityUsed),
    costPerUnit: toNumber(chemicalUsage.costPerUnit),
    currentStockQty: toNumber(currentStock?.quantity),
  };
}

export function calculateRecoveryLoss(input: {
  expectedQuantity: number;
  recoveredQuantity: number;
  costPerUnit: number;
}) {
  const lossQuantity = Math.max(0, input.expectedQuantity - input.recoveredQuantity);
  const lossAmount = Number((lossQuantity * input.costPerUnit).toFixed(2));

  return {
    lossQuantity,
    lossAmount,
  };
}
