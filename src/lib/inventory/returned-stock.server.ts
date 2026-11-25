import Big from "big.js";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { recipes, returnedFinishedGoodsStock } from "@/db/schemas/inventory-schema";
import { returnedStockMovements, salesReturnStockTraces } from "@/db/schemas/sales-erp-schema";
import { formatRupees } from "@/lib/finance/expense-entry";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";
import {
  poolShare,
  RETURNED_STOCK_SALE_REVERSAL_SOURCE,
  RETURNED_STOCK_SALE_SOURCE,
  returnedPacking,
  secondsSaleAmount,
  writeDownAmount,
  type ReturnedCondition,
} from "./returned-stock";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReturnedStockKey = { warehouseId: string; recipeId: string; condition: ReturnedCondition };
type Movement = typeof returnedStockMovements.$inferSelect;

/** Locks one returned stock row the same way receiving and voiding a return do. */
async function lockReturnedRow(tx: Tx, key: ReturnedStockKey) {
  await lockFinishedGoods(tx, key.warehouseId, [key.recipeId]);
  const [row] = await tx
    .select()
    .from(returnedFinishedGoodsStock)
    .where(
      and(
        eq(returnedFinishedGoodsStock.warehouseId, key.warehouseId),
        eq(returnedFinishedGoodsStock.recipeId, key.recipeId),
        eq(returnedFinishedGoodsStock.condition, key.condition),
      ),
    )
    .for("update");
  if (!row) throw new Error("This returned stock was not found.");
  const recipe = await tx.query.recipes.findFirst({
    where: eq(recipes.id, key.recipeId),
    columns: { name: true, cartonPackagingId: true, containersPerCarton: true },
  });
  if (!recipe) throw new Error("Item not found");
  const packing = returnedPacking(recipe);
  return {
    row,
    recipe,
    ...packing,
    units: row.quantityCartons * packing.unitsPerCarton + row.quantityContainers,
    value: new Big(row.totalInventoryValue ?? 0).toFixed(2),
  };
}
type LockedRow = Awaited<ReturnType<typeof lockReturnedRow>>;

async function writeReturnedRow(tx: Tx, locked: LockedRow, nextUnits: number, nextValue: Big) {
  const wac = nextUnits > 0 ? nextValue.div(nextUnits) : new Big(0);
  await tx
    .update(returnedFinishedGoodsStock)
    .set({
      quantityCartons: locked.usesCartons ? Math.floor(nextUnits / locked.unitsPerCarton) : 0,
      quantityContainers: locked.usesCartons ? nextUnits % locked.unitsPerCarton : nextUnits,
      weightedAverageCostPerPack: wac.toFixed(4),
      weightedAverageCostPerCarton: locked.usesCartons ? wac.times(locked.unitsPerCarton).toFixed(4) : "0.0000",
      totalInventoryValue: nextValue.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(returnedFinishedGoodsStock.id, locked.row.id));
}

/**
 * Adds or removes money on one account and writes its ledger row. A debit is refused when the
 * account holds less than the amount; the balance check and update are one row-locking statement.
 */
async function moveWalletMoney(
  tx: Tx,
  input: { walletId: string; type: "credit" | "debit"; amount: string; source: string; referenceId: string; performedById: string; description: string },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance: input.type === "credit" ? sql`${wallets.balance} + ${input.amount}` : sql`${wallets.balance} - ${input.amount}`,
    })
    .where(
      input.type === "debit"
        ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
        : eq(wallets.id, input.walletId),
    )
    .returning({ id: wallets.id });
  if (!wallet) {
    const existing = await tx.query.wallets.findFirst({ where: eq(wallets.id, input.walletId), columns: { name: true, balance: true } });
    if (!existing) throw new Error("Account not found");
    throw new Error(`${existing.name} has only ${formatRupees(existing.balance)}. Voiding would take it below zero.`);
  }
  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    source: input.source,
    referenceId: input.referenceId,
    description: input.description,
    performedById: input.performedById,
  });
  return id;
}

async function insertMovement(tx: Tx, values: typeof returnedStockMovements.$inferInsert): Promise<Movement> {
  // Stamped while the stock lock is held, so createdAt follows the order entries really happened in.
  const [movement] = await tx
    .insert(returnedStockMovements)
    .values({ ...values, createdAt: sql`clock_timestamp()` })
    .returning();
  return movement;
}

/** A lowered value belongs to the packs it was taken from, so it can't go back once some of them left. */
async function assertNoPacksLeftSince(tx: Tx, revalue: Movement) {
  const [disposal] = await tx
    .select({ id: returnedStockMovements.id })
    .from(returnedStockMovements)
    .where(
      and(
        eq(returnedStockMovements.warehouseId, revalue.warehouseId),
        eq(returnedStockMovements.recipeId, revalue.recipeId),
        eq(returnedStockMovements.condition, revalue.condition),
        inArray(returnedStockMovements.kind, ["scrap", "seconds_sale"]),
        isNull(returnedStockMovements.voidedAt),
        gt(returnedStockMovements.createdAt, revalue.createdAt),
      ),
    )
    .limit(1);
  if (disposal) throw new Error("Some of these packs were scrapped or sold since. Void those entries first.");
  const [voidedReturn] = await tx
    .select({ id: salesReturnStockTraces.id })
    .from(salesReturnStockTraces)
    .where(
      and(
        eq(salesReturnStockTraces.warehouseId, revalue.warehouseId),
        eq(salesReturnStockTraces.recipeId, revalue.recipeId),
        eq(salesReturnStockTraces.destination, revalue.condition),
        eq(salesReturnStockTraces.kind, "void"),
        gt(salesReturnStockTraces.createdAt, revalue.createdAt),
      ),
    )
    .limit(1);
  if (voidedReturn) {
    throw new Error("Some of these packs left stock when a return was voided, so the old value can't be put back.");
  }
}

export async function scrapReturnedStock(
  tx: Tx,
  input: ReturnedStockKey & { units: number; note?: string; userId: string },
): Promise<Movement> {
  const locked = await lockReturnedRow(tx, input);
  const removed = poolShare({ units: locked.units, value: locked.value }, input.units);
  await writeReturnedRow(tx, locked, locked.units - input.units, new Big(locked.value).minus(removed));
  return insertMovement(tx, {
    kind: "scrap",
    warehouseId: input.warehouseId,
    recipeId: input.recipeId,
    condition: input.condition,
    units: input.units,
    unitsBefore: locked.units,
    valueBefore: locked.value,
    valueRemoved: removed,
    lossAmount: removed,
    note: input.note || null,
    performedById: input.userId,
  });
}

export async function sellReturnedStock(
  tx: Tx,
  input: ReturnedStockKey & { units: number; unitPrice: number; walletId: string; note?: string; userId: string },
): Promise<Movement> {
  const locked = await lockReturnedRow(tx, input);
  const removed = poolShare({ units: locked.units, value: locked.value }, input.units);
  const saleAmount = secondsSaleAmount(input.units, input.unitPrice);
  await writeReturnedRow(tx, locked, locked.units - input.units, new Big(locked.value).minus(removed));
  const id = createId();
  const transactionId = await moveWalletMoney(tx, {
    walletId: input.walletId,
    type: "credit",
    amount: saleAmount,
    source: RETURNED_STOCK_SALE_SOURCE,
    referenceId: id,
    performedById: input.userId,
    description: `Sold ${input.units} ${input.condition} ${locked.recipe.name} as seconds`,
  });
  return insertMovement(tx, {
    id,
    kind: "seconds_sale",
    warehouseId: input.warehouseId,
    recipeId: input.recipeId,
    condition: input.condition,
    units: input.units,
    unitsBefore: locked.units,
    valueBefore: locked.value,
    valueRemoved: removed,
    unitPrice: new Big(input.unitPrice).toFixed(2),
    saleAmount,
    lossAmount: new Big(removed).minus(saleAmount).toFixed(2),
    walletId: input.walletId,
    transactionId,
    note: input.note || null,
    performedById: input.userId,
  });
}

export async function setReturnedStockValue(
  tx: Tx,
  input: ReturnedStockKey & { valuePerPack: number; note: string; userId: string },
): Promise<Movement> {
  const locked = await lockReturnedRow(tx, input);
  const { newValue, writeDown } = writeDownAmount({ units: locked.units, value: locked.value }, input.valuePerPack);
  await writeReturnedRow(tx, locked, locked.units, new Big(newValue));
  return insertMovement(tx, {
    kind: "revalue",
    warehouseId: input.warehouseId,
    recipeId: input.recipeId,
    condition: input.condition,
    units: 0,
    unitsBefore: locked.units,
    valueBefore: locked.value,
    valueRemoved: writeDown,
    unitPrice: new Big(input.valuePerPack).toFixed(2),
    lossAmount: writeDown,
    note: input.note,
    performedById: input.userId,
  });
}

/** Puts the packs and value back (and the sale money back out), dated today. The row is kept. */
export async function voidReturnedStockMovement(
  tx: Tx,
  input: { movementId: string; reason: string; userId: string },
): Promise<Movement> {
  const [movement] = await tx
    .select()
    .from(returnedStockMovements)
    .where(eq(returnedStockMovements.id, input.movementId))
    .for("update");
  if (!movement) throw new Error("Entry not found");
  if (movement.voidedAt) throw new Error("This entry is already voided.");
  const locked = await lockReturnedRow(tx, {
    warehouseId: movement.warehouseId,
    recipeId: movement.recipeId,
    condition: movement.condition as ReturnedCondition,
  });
  if (movement.kind === "revalue") await assertNoPacksLeftSince(tx, movement);
  await writeReturnedRow(
    tx,
    locked,
    locked.units + movement.units,
    new Big(locked.value).plus(movement.valueRemoved),
  );
  let voidTransactionId: string | null = null;
  if (movement.kind === "seconds_sale" && movement.walletId && movement.saleAmount) {
    voidTransactionId = await moveWalletMoney(tx, {
      walletId: movement.walletId,
      type: "debit",
      amount: movement.saleAmount,
      source: RETURNED_STOCK_SALE_REVERSAL_SOURCE,
      referenceId: movement.id,
      performedById: input.userId,
      description: `Void of seconds sale: ${locked.recipe.name}`,
    });
  }
  const [voided] = await tx
    .update(returnedStockMovements)
    .set({ voidedAt: new Date(), voidedById: input.userId, voidReason: input.reason, voidTransactionId, updatedAt: new Date() })
    .where(eq(returnedStockMovements.id, movement.id))
    .returning();
  return voided;
}
