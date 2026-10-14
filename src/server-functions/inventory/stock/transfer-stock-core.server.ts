import Big from "big.js";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  adjustmentLog,
  cartons,
  finishedGoodsStock,
  materialStock,
  recipes,
} from "@/db";
import { deriveCartonStatus } from "@/lib/cartons/carton.guards";
import {
  adjustCartonStock,
  lockCartonStock,
} from "@/lib/cartons/stock-adjustment.server";

import { moveOutsidePacks } from "@/lib/cartons/outside-packs.server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Movement = {
  fromWarehouseId: string;
  toWarehouseId: string;
  recipeId: string;
  userId: string;
  referenceId: string;
};

// A warehouse closure also relocates held and empty trace records for future returns.
export async function transferFinishedStock(
  tx: Tx,
  input: Movement & {
    cartons?: number;
    looseUnits?: number;
    relocateAll?: boolean;
  },
) {
  const sourceRef = {
    warehouseId: input.fromWarehouseId,
    recipeId: input.recipeId,
  };
  const targetRef = {
    warehouseId: input.toWarehouseId,
    recipeId: input.recipeId,
  };
  await lockCartonStock(tx, [sourceRef, targetRef]);
  const recipe = await tx.query.recipes.findFirst({
    where: eq(recipes.id, input.recipeId),
  });
  const stock = await tx.query.finishedGoodsStock.findFirst({
    where: and(
      eq(finishedGoodsStock.recipeId, input.recipeId),
      eq(finishedGoodsStock.warehouseId, input.fromWarehouseId),
    ),
  });
  if (!recipe || !stock) throw new Error("Finished goods stock not found");
  const capacity = recipe.cartonPackagingId
    ? (recipe.containersPerCarton ?? 0)
    : 0;
  const sourceUnits =
    stock.quantityCartons * capacity + stock.quantityContainers;
  const count = input.cartons ?? 0;
  if (!capacity && count)
    throw new Error("This recipe has no cartons; transfer loose units");
  const units = input.relocateAll
    ? sourceUnits
    : count * capacity + (input.looseUnits ?? 0);
  if (units <= 0 && !input.relocateAll)
    throw new Error("Transfer quantity must be positive");
  if (units > sourceUnits)
    throw new Error("Insufficient finished stock for transfer");

  const rows = await tx
    .select()
    .from(cartons)
    .where(
      and(
        eq(cartons.recipeId, input.recipeId),
        eq(cartons.warehouseId, input.fromWarehouseId),
      ),
    )
    .orderBy(cartons.id)
    .for("update");
  const live = rows.filter(
    (row) => !["ARCHIVED", "RETIRED"].includes(row.status),
  );
  if (
    capacity &&
    recipe.formulaId &&
    live.reduce((sum, row) => sum + row.currentPacks, 0) + stock.quantityOutsidePacks !== sourceUnits
  )
    throw new Error(
      "Finished stock and carton contents disagree; run an integrity check",
    );
  const warehouseLedger = (row: typeof cartons.$inferSelect) => [
    {
      cartonId: row.id,
      batchId: row.productionRunId,
      packagingAllocationId: row.packagingAllocationId,
      sku: row.sku,
      type: "TRANSFER_OUT",
      packsBefore: row.currentPacks,
      delta: -row.currentPacks,
      packsAfter: 0,
      reason: `Warehouse transfer from ${input.fromWarehouseId} to ${input.toWarehouseId}`,
      performedBy: input.userId,
    },
    {
      cartonId: row.id,
      batchId: row.productionRunId,
      packagingAllocationId: row.packagingAllocationId,
      sku: row.sku,
      type: "TRANSFER_IN",
      packsBefore: 0,
      delta: row.currentPacks,
      packsAfter: row.currentPacks,
      reason: `Warehouse transfer from ${input.fromWarehouseId} to ${input.toWarehouseId}`,
      performedBy: input.userId,
    },
  ];

  const availableOutside = capacity ? stock.quantityOutsidePacks : sourceUnits;
  const outsideMoved = input.relocateAll ? availableOutside : Math.min(input.looseUnits ?? 0, availableOutside);
  if (input.relocateAll) {
    if (rows.length)
      await tx
        .update(cartons)
        .set({ warehouseId: input.toWarehouseId, updatedAt: new Date() })
        .where(
          inArray(
            cartons.id,
            rows.map((row) => row.id),
          ),
        );
    const ledger = live
      .filter((row) => row.currentPacks > 0)
      .flatMap(warehouseLedger);
    if (ledger.length) await tx.insert(adjustmentLog).values(ledger);
  } else if (capacity && rows.length) {
    const available = live.filter(
      (row) =>
        ["COMPLETE", "PARTIAL", "SEALED"].includes(row.status) &&
        row.currentPacks > 0,
    );
    const full = available
      .filter(
        (row) => row.currentPacks === capacity && row.capacity === capacity,
      )
      .slice(0, count);
    if (full.length !== count)
      throw new Error("Insufficient full cartons for transfer");
    const fullIds = new Set(full.map((row) => row.id));
    const looseRows = available
      .filter((row) => !fullIds.has(row.id))
      .sort(
        (a, b) =>
          Number(a.currentPacks === a.capacity) -
            Number(b.currentPacks === b.capacity) || a.id.localeCompare(b.id),
      );
    let remaining = (input.looseUnits ?? 0) - outsideMoved;
    if (looseRows.reduce((sum, row) => sum + row.currentPacks, 0) < remaining)
      throw new Error("Insufficient available packs for transfer");
    for (const carton of full) {
      await tx
        .update(cartons)
        .set({ warehouseId: input.toWarehouseId, updatedAt: new Date() })
        .where(eq(cartons.id, carton.id));
      await tx.insert(adjustmentLog).values(warehouseLedger(carton));
    }
    for (const source of looseRows) {
      if (!remaining) break;
      const moved = Math.min(source.currentPacks, remaining);
      if (moved === source.currentPacks) {
        await tx
          .update(cartons)
          .set({ warehouseId: input.toWarehouseId, updatedAt: new Date() })
          .where(eq(cartons.id, source.id));
        await tx.insert(adjustmentLog).values(warehouseLedger(source));
      } else {
        if (source.status === "SEALED")
          await tx
            .insert(adjustmentLog)
            .values({
              cartonId: source.id,
              batchId: source.productionRunId,
              packagingAllocationId: source.packagingAllocationId,
              sku: source.sku,
              type: "UNSEALED",
              packsBefore: source.currentPacks,
              delta: 0,
              packsAfter: source.currentPacks,
              reason: "Unsealed by warehouse pack transfer",
              performedBy: input.userId,
            });
        const after = source.currentPacks - moved;
        await tx
          .update(cartons)
          .set({
            currentPacks: after,
            status: deriveCartonStatus(after, source.capacity),
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, source.id));
        const [target] = await tx
          .insert(cartons)
          .values({
            recipeId: source.recipeId,
            productionRunId: source.productionRunId,
            packagingAllocationId: source.packagingAllocationId,
            warehouseId: input.toWarehouseId,
            sku: source.sku,
            capacity: source.capacity,
            currentPacks: moved,
            status: deriveCartonStatus(moved, source.capacity),
          })
          .returning();
        await tx.insert(adjustmentLog).values([
          {
            cartonId: source.id,
            batchId: source.productionRunId,
            packagingAllocationId: source.packagingAllocationId,
            sku: source.sku,
            type: "TRANSFER_OUT",
            packsBefore: source.currentPacks,
            delta: -moved,
            packsAfter: after,
            relatedCartonId: target.id,
            reason: "Warehouse stock transfer",
            performedBy: input.userId,
          },
          {
            cartonId: target.id,
            batchId: target.productionRunId,
            packagingAllocationId: target.packagingAllocationId,
            sku: target.sku,
            type: "TRANSFER_IN",
            packsBefore: 0,
            delta: moved,
            packsAfter: moved,
            relatedCartonId: source.id,
            reason: "Warehouse stock transfer",
            performedBy: input.userId,
          },
        ]);
      }
      remaining -= moved;
    }
  } else if (capacity && recipe.formulaId && units > outsideMoved)
    throw new Error("No transferable cartons found");

  if (units || (input.relocateAll && rows.length)) {
    await tx
      .insert(finishedGoodsStock)
      .values({
        ...targetRef,
        weightedAverageCostPerPack: stock.weightedAverageCostPerPack,
        weightedAverageCostPerCarton: stock.weightedAverageCostPerCarton,
      })
      .onConflictDoNothing();
  }
  if (outsideMoved) {
    await moveOutsidePacks(tx, { ...sourceRef, delta: -outsideMoved, referenceId: input.referenceId, type: "TRANSFER_OUT", userId: input.userId });
    await moveOutsidePacks(tx, { ...targetRef, delta: outsideMoved, referenceId: input.referenceId, type: "TRANSFER_IN", userId: input.userId });
  }
  if (units) {
    const value = await adjustCartonStock(
      tx,
      sourceRef,
      -units,
      input.userId,
      input.referenceId,
    );
    await adjustCartonStock(
      tx,
      targetRef,
      units,
      input.userId,
      input.referenceId,
      undefined,
      value,
    );
  }
  return units;
}

export async function transferMaterialStock(
  tx: Tx,
  input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    materialType: "chemical" | "packaging";
    materialId: string;
    quantity: string;
  },
) {
  const column =
    input.materialType === "chemical"
      ? materialStock.chemicalId
      : materialStock.packagingMaterialId;
  await tx
    .select({ id: materialStock.id })
    .from(materialStock)
    .where(
      and(
        inArray(materialStock.warehouseId, [
          input.fromWarehouseId,
          input.toWarehouseId,
        ]),
        eq(column, input.materialId),
      ),
    )
    .orderBy(materialStock.warehouseId)
    .for("update");
  const quantity = new Big(input.quantity).toFixed(3);
  const [debited] = await tx
    .update(materialStock)
    .set({
      quantity: sql`${materialStock.quantity} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(materialStock.warehouseId, input.fromWarehouseId),
        eq(column, input.materialId),
        gte(materialStock.quantity, quantity),
      ),
    )
    .returning();
  if (!debited) throw new Error("Insufficient stock for transfer");
  await tx
    .insert(materialStock)
    .values({
      warehouseId: input.toWarehouseId,
      chemicalId: input.materialType === "chemical" ? input.materialId : null,
      packagingMaterialId:
        input.materialType === "packaging" ? input.materialId : null,
      quantity,
    })
    .onConflictDoUpdate({
      target: [materialStock.warehouseId, column],
      targetWhere: sql`${column} IS NOT NULL`,
      set: {
        quantity: sql`${materialStock.quantity} + ${quantity}`,
        updatedAt: new Date(),
      },
    });
}
