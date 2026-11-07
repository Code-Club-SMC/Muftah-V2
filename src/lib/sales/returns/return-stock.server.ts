import Big from "big.js";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import {
  finishedGoodsStock,
  returnedFinishedGoodsStock,
  type recipes,
} from "@/db/schemas/inventory-schema";
import type { invoiceItems } from "@/db/schemas/sales-schema";
import { salesReturnStockTraces } from "@/db/schemas/sales-erp-schema";
import { recordSalesReturnCartons } from "@/lib/cartons/sales-return.server";
import { splitUnits, type ReturnCondition } from "./return-lifecycle";
import { adjustmentLog, cartons } from "@/db/schemas/manufacturing-schema";
import { outsidePackMovements } from "@/db/schemas/production-schema";
import { dispatchInvoiceCartons } from "@/lib/cartons/invoice-stock.server";
import { adjustCartonStock } from "@/lib/cartons/stock-adjustment.server";
import { getReturnUnitsPerCarton } from "./refund-pricing";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type InvoiceItemWithRecipe = typeof invoiceItems.$inferSelect & {
  recipe: typeof recipes.$inferSelect | null;
};

function calculateInboundStockState(params: {
  existingCartons: number;
  existingContainers: number;
  existingTotalInventoryValue: string;
  unitsPerCarton: number;
  inboundUnits: number;
  inboundInventoryValue: string;
  usesCartons: boolean;
}) {
  const existingUnits = params.existingCartons * params.unitsPerCarton + params.existingContainers;
  const nextUnits = existingUnits + params.inboundUnits;
  const nextTotalInventoryValue = new Big(params.existingTotalInventoryValue).plus(params.inboundInventoryValue);
  const nextCartons = params.usesCartons ? Math.floor(nextUnits / params.unitsPerCarton) : 0;
  const nextContainers = params.usesCartons ? nextUnits % params.unitsPerCarton : nextUnits;
  const nextWacPerPack = nextUnits > 0 ? nextTotalInventoryValue.div(nextUnits) : new Big(0);
  const nextWacPerCarton = params.usesCartons ? nextWacPerPack.times(params.unitsPerCarton) : new Big(0);
  return { nextCartons, nextContainers, nextTotalInventoryValue, nextWacPerPack, nextWacPerCarton };
}

/**
 * Puts received units of one condition back into stock and records the trace.
 * Good units go to sellable stock; damaged and expired go to segregated returned stock.
 * Caller holds the return, carton-order, invoice and finished-goods locks.
 */
export async function restockReturnedUnits(
  tx: Tx,
  input: {
    salesReturnId: string;
    returnItemId: string;
    invoiceId: string;
    invoiceItem: InvoiceItemWithRecipe;
    warehouseId: string;
    condition: ReturnCondition;
    units: number;
    unitsPerCarton: number;
    costPerUnit: number;
    inventoryValue: string;
    userId: string;
  },
) {
  const recipeId = input.invoiceItem.recipeId;
  if (!recipeId) {
    throw new Error(`Invoice item "${input.invoiceItem.pack}" cannot be restocked because it has no recipe mapping`);
  }
  const usesCartons =
    !!input.invoiceItem.recipe?.cartonPackagingId && (input.invoiceItem.recipe.containersPerCarton ?? 0) > 0;

  await recordSalesReturnCartons(tx, {
    invoiceId: input.invoiceId,
    salesReturnId: input.salesReturnId,
    recipeId,
    warehouseId: input.warehouseId,
    units: input.units,
    good: input.condition === "good",
    userId: input.userId,
  });

  if (input.condition === "good") {
    const existing = await tx.query.finishedGoodsStock.findFirst({
      where: and(eq(finishedGoodsStock.warehouseId, input.warehouseId), eq(finishedGoodsStock.recipeId, recipeId)),
    });
    const next = calculateInboundStockState({
      existingCartons: existing?.quantityCartons ?? 0,
      existingContainers: existing?.quantityContainers ?? 0,
      existingTotalInventoryValue: existing?.totalInventoryValue ?? "0",
      unitsPerCarton: input.unitsPerCarton,
      inboundUnits: input.units,
      inboundInventoryValue: input.inventoryValue,
      usesCartons,
    });
    const values = {
      quantityCartons: next.nextCartons,
      quantityContainers: next.nextContainers,
      weightedAverageCostPerPack: next.nextWacPerPack.toFixed(4),
      weightedAverageCostPerCarton: next.nextWacPerCarton.toFixed(4),
      totalInventoryValue: next.nextTotalInventoryValue.toFixed(2),
    };
    if (existing) {
      await tx
        .update(finishedGoodsStock)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(finishedGoodsStock.id, existing.id));
    } else {
      await tx.insert(finishedGoodsStock).values({ id: createId(), warehouseId: input.warehouseId, recipeId, ...values });
    }
  } else {
    const existing = await tx.query.returnedFinishedGoodsStock.findFirst({
      where: and(
        eq(returnedFinishedGoodsStock.warehouseId, input.warehouseId),
        eq(returnedFinishedGoodsStock.recipeId, recipeId),
        eq(returnedFinishedGoodsStock.condition, input.condition),
      ),
    });
    const next = calculateInboundStockState({
      existingCartons: existing?.quantityCartons ?? 0,
      existingContainers: existing?.quantityContainers ?? 0,
      existingTotalInventoryValue: existing?.totalInventoryValue ?? "0",
      unitsPerCarton: input.unitsPerCarton,
      inboundUnits: input.units,
      inboundInventoryValue: input.inventoryValue,
      usesCartons,
    });
    const values = {
      quantityCartons: next.nextCartons,
      quantityContainers: next.nextContainers,
      weightedAverageCostPerPack: next.nextWacPerPack.toFixed(4),
      weightedAverageCostPerCarton: next.nextWacPerCarton.toFixed(4),
      totalInventoryValue: next.nextTotalInventoryValue.toFixed(2),
    };
    if (existing) {
      await tx
        .update(returnedFinishedGoodsStock)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(returnedFinishedGoodsStock.id, existing.id));
    } else {
      await tx.insert(returnedFinishedGoodsStock).values({
        id: createId(),
        warehouseId: input.warehouseId,
        recipeId,
        condition: input.condition,
        ...values,
      });
    }
  }

  const { cartons, loose } = splitUnits(input.units, input.unitsPerCarton);
  await tx.insert(salesReturnStockTraces).values({
    id: createId(),
    salesReturnId: input.salesReturnId,
    salesReturnItemId: input.returnItemId,
    invoiceId: input.invoiceId,
    invoiceItemId: input.invoiceItem.id,
    warehouseId: input.warehouseId,
    recipeId,
    destination: input.condition === "good" ? "sellable" : input.condition,
    condition: input.condition,
    kind: "receive",
    cartonsMoved: cartons,
    quantityMoved: loose,
    totalUnitsMoved: input.units,
    costPerUnit: input.costPerUnit.toFixed(4),
    totalCost: input.inventoryValue,
  });
}

export type ReceiveTrace = typeof salesReturnStockTraces.$inferSelect & {
  recipe: typeof recipes.$inferSelect;
  invoiceItem: { packsPerCarton: number | null; actualPackSize: number | null };
};

const PLACE: Record<string, string> = { sellable: "sellable stock", damaged: "damaged stock", expired: "expired stock" };

function cartonCapacity(recipe: typeof recipes.$inferSelect) {
  return recipe.cartonPackagingId ? recipe.containersPerCarton ?? 0 : 0;
}

async function takeFromReturnedStock(
  tx: Tx,
  input: { warehouseId: string; recipeId: string; condition: string; units: number; unitsPerCarton: number; usesCartons: boolean },
): Promise<Big> {
  const stock = await tx.query.returnedFinishedGoodsStock.findFirst({
    where: and(
      eq(returnedFinishedGoodsStock.warehouseId, input.warehouseId),
      eq(returnedFinishedGoodsStock.recipeId, input.recipeId),
      eq(returnedFinishedGoodsStock.condition, input.condition),
    ),
  });
  if (!stock) throw new Error("Returned stock not found");
  const oldUnits = stock.quantityCartons * input.unitsPerCarton + stock.quantityContainers;
  const nextUnits = oldUnits - input.units;
  const oldValue = new Big(stock.totalInventoryValue ?? 0);
  const removed = nextUnits === 0 ? oldValue : new Big(oldValue.times(input.units).div(oldUnits).toFixed(2));
  const nextValue = oldValue.minus(removed);
  const wac = nextUnits > 0 ? nextValue.div(nextUnits) : new Big(0);
  await tx
    .update(returnedFinishedGoodsStock)
    .set({
      quantityCartons: input.usesCartons ? Math.floor(nextUnits / input.unitsPerCarton) : 0,
      quantityContainers: input.usesCartons ? nextUnits % input.unitsPerCarton : nextUnits,
      weightedAverageCostPerPack: wac.toFixed(4),
      weightedAverageCostPerCarton: input.usesCartons ? wac.times(input.unitsPerCarton).toFixed(4) : "0.0000",
      totalInventoryValue: nextValue.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(returnedFinishedGoodsStock.id, stock.id));
  return removed;
}

/** Cancels this return's damaged/expired entries in the carton dispatch ledgers, once per recipe. */
async function reverseDamagedReturnCartons(
  tx: Tx,
  input: { invoiceId: string; salesReturnId: string; recipeId: string; warehouseId: string; units: number; userId: string },
) {
  const rows = await tx
    .select({ log: adjustmentLog })
    .from(adjustmentLog)
    .innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id))
    .where(
      and(
        eq(adjustmentLog.dispatchOrderId, input.invoiceId),
        eq(adjustmentLog.type, "RETURN_DAMAGED"),
        eq(adjustmentLog.reason, `Sales return ${input.salesReturnId}`),
        eq(cartons.recipeId, input.recipeId),
      ),
    );
  let cartonUnits = 0;
  for (const { log } of rows) {
    cartonUnits += log.delta;
    await tx.insert(adjustmentLog).values({
      cartonId: log.cartonId,
      relatedCartonId: log.relatedCartonId,
      batchId: log.batchId,
      packagingAllocationId: log.packagingAllocationId,
      sku: log.sku,
      type: "RETURN_DAMAGED",
      packsBefore: log.packsAfter,
      delta: -log.delta,
      packsAfter: log.packsAfter,
      reason: `Sales return ${input.salesReturnId} voided`,
      dispatchOrderId: input.invoiceId,
      returnRecordId: log.returnRecordId,
      performedBy: input.userId,
    });
  }
  const outside = input.units - cartonUnits;
  if (outside < 0) throw new Error("Returned carton ledger does not match this return");
  if (outside > 0) {
    await tx.insert(outsidePackMovements).values({
      warehouseId: input.warehouseId,
      recipeId: input.recipeId,
      referenceId: input.invoiceId,
      type: "RETURN_DAMAGED",
      delta: -outside,
      actorId: input.userId,
    });
  }
}

/**
 * Takes a completed return's goods back out of stock and writes negative "void" traces.
 * Caller holds the return, carton-order, invoice and finished-goods locks.
 */
export async function reverseReturnStock(
  tx: Tx,
  input: { salesReturnId: string; returnNumber: number; invoiceId: string; userId: string; traces: ReceiveTrace[] },
) {
  const groups = new Map<string, ReceiveTrace[]>();
  for (const trace of input.traces) {
    const key = `${trace.destination}|${trace.warehouseId}|${trace.recipeId}`;
    groups.set(key, [...(groups.get(key) ?? []), trace]);
  }

  // Check every group first so a shortage stops the void before anything moves.
  for (const traces of groups.values()) {
    const [first] = traces;
    const units = traces.reduce((sum, trace) => sum + trace.totalUnitsMoved, 0);
    let available = 0;
    if (first.destination === "sellable") {
      const stock = await tx.query.finishedGoodsStock.findFirst({
        where: and(eq(finishedGoodsStock.warehouseId, first.warehouseId), eq(finishedGoodsStock.recipeId, first.recipeId)),
      });
      available = stock ? stock.quantityCartons * cartonCapacity(first.recipe) + stock.quantityContainers : 0;
    } else {
      const stock = await tx.query.returnedFinishedGoodsStock.findFirst({
        where: and(
          eq(returnedFinishedGoodsStock.warehouseId, first.warehouseId),
          eq(returnedFinishedGoodsStock.recipeId, first.recipeId),
          eq(returnedFinishedGoodsStock.condition, first.destination),
        ),
      });
      available = stock
        ? stock.quantityCartons * getReturnUnitsPerCarton(first.invoiceItem) + stock.quantityContainers
        : 0;
    }
    if (available < units) {
      throw new Error(
        `Return #${input.returnNumber} can't be voided: ${units} packs of ${first.recipe.name} went to ${PLACE[first.destination] ?? first.destination} but only ${available} are left. Some were sold or used since.`,
      );
    }
  }

  const voidTraces: Array<typeof salesReturnStockTraces.$inferInsert> = [];
  const nonSellableByRecipe = new Map<string, { warehouseId: string; recipeId: string; units: number }>();

  for (const traces of groups.values()) {
    const [first] = traces;
    const units = traces.reduce((sum, trace) => sum + trace.totalUnitsMoved, 0);
    let removedValue: Big;
    if (first.destination === "sellable") {
      await dispatchInvoiceCartons(tx, {
        warehouseId: first.warehouseId,
        recipeId: first.recipeId,
        invoiceId: input.invoiceId,
        userId: input.userId,
        units,
        containersPerCarton: cartonCapacity(first.recipe),
        unitType: "units",
        strict: false,
      });
      removedValue = new Big(
        await adjustCartonStock(
          tx,
          { warehouseId: first.warehouseId, recipeId: first.recipeId },
          -units,
          input.userId,
          input.salesReturnId,
          undefined,
          undefined,
          `Sales return #${input.returnNumber} voided`,
        ),
      );
    } else {
      removedValue = await takeFromReturnedStock(tx, {
        warehouseId: first.warehouseId,
        recipeId: first.recipeId,
        condition: first.destination,
        units,
        unitsPerCarton: getReturnUnitsPerCarton(first.invoiceItem),
        usesCartons: cartonCapacity(first.recipe) > 0,
      });
      const key = `${first.warehouseId}|${first.recipeId}`;
      const entry = nonSellableByRecipe.get(key) ?? { warehouseId: first.warehouseId, recipeId: first.recipeId, units: 0 };
      entry.units += units;
      nonSellableByRecipe.set(key, entry);
    }

    // Split the removed value across this group's traces; the last one keeps the residual cents.
    let valueLeft = removedValue;
    let unitsLeft = units;
    for (const trace of traces) {
      const share =
        unitsLeft === trace.totalUnitsMoved
          ? valueLeft
          : removedValue.times(trace.totalUnitsMoved).div(units).round(2);
      valueLeft = valueLeft.minus(share);
      unitsLeft -= trace.totalUnitsMoved;
      voidTraces.push({
        id: createId(),
        salesReturnId: trace.salesReturnId,
        salesReturnItemId: trace.salesReturnItemId,
        invoiceId: trace.invoiceId,
        invoiceItemId: trace.invoiceItemId,
        warehouseId: trace.warehouseId,
        recipeId: trace.recipeId,
        destination: trace.destination,
        condition: trace.condition,
        kind: "void",
        cartonsMoved: -trace.cartonsMoved,
        quantityMoved: -trace.quantityMoved,
        totalUnitsMoved: -trace.totalUnitsMoved,
        costPerUnit: trace.totalUnitsMoved > 0 ? share.div(trace.totalUnitsMoved).toFixed(4) : "0.0000",
        // Big keeps the sign of zero, so write zero explicitly instead of "-0.00".
        totalCost: share.eq(0) ? "0.00" : share.times(-1).toFixed(2),
      });
    }
  }

  // Damaged and expired share one carton-ledger type, so undo it once per recipe.
  for (const entry of nonSellableByRecipe.values()) {
    await reverseDamagedReturnCartons(tx, {
      invoiceId: input.invoiceId,
      salesReturnId: input.salesReturnId,
      recipeId: entry.recipeId,
      warehouseId: entry.warehouseId,
      units: entry.units,
      userId: input.userId,
    });
  }

  if (voidTraces.length > 0) await tx.insert(salesReturnStockTraces).values(voidTraces);
}
