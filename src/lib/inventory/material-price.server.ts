import { and, asc, desc, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
import Big from "big.js";
import type { db } from "@/db";
import { chemicals, materialLotMovements, materialLots, materialLotStock, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { lotPrice, type MaterialRef, type MaterialType } from "./material-lots";
import { purchaseStockLeft } from "@/lib/suppliers/purchase-rows.server";
import { findOrCreateLot, lockMaterialStock, moveLotStock, type Tx } from "./material-lots.server";

// The item's current price (costPerUnit) is what the next kg or piece is expected to cost.
// It follows the newest purchase. Stock already bought keeps its own lot price.

// Locks the item in every store that holds it. Stock from before lots becomes a lot at the
// price saved now, so this must run before the price changes.
export async function lockMaterialEverywhere(tx: Tx, ref: MaterialRef, warehouseIds: string[] = []) {
  const column = ref.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId;
  const stores = await tx.select({ id: materialStock.warehouseId }).from(materialStock).where(eq(column, ref.materialId));
  await lockMaterialStock(tx, [...warehouseIds, ...stores.map((row) => row.id)], [ref]);
}

// Call lockMaterialEverywhere first. Free stock says nothing about what the item costs, so a zero price is ignored.
export async function setMaterialPrice(tx: Tx, ref: MaterialRef, unitPrice: string | Big) {
  const price = lotPrice(unitPrice);
  if (new Big(price).eq(0)) return;
  if (ref.materialType === "chemical") {
    await tx.update(chemicals).set({ costPerUnit: price }).where(eq(chemicals.id, ref.materialId));
  } else {
    await tx.update(packagingMaterials)
      .set({ costPerUnit: price, pricePerKg: sql`case when ${packagingMaterials.measuredInKg} then ${price}::numeric else ${packagingMaterials.pricePerKg} end` })
      .where(eq(packagingMaterials.id, ref.materialId));
  }
}

export function newestPurchases(tx: Tx, ref: MaterialRef) {
  const column = ref.materialType === "chemical" ? purchaseRecords.chemicalId : purchaseRecords.packagingMaterialId;
  return tx.select({ id: purchaseRecords.id, unitCost: purchaseRecords.unitCost, purchaseDate: purchaseRecords.purchaseDate }).from(purchaseRecords)
    .where(and(eq(column, ref.materialId), isNull(purchaseRecords.voidedAt), gt(purchaseRecords.unitCost, "0")))
    .orderBy(desc(purchaseRecords.purchaseDate), desc(purchaseRecords.createdAt), desc(purchaseRecords.id)).limit(2);
}

// The bill of a partly used purchase was corrected: what is left of it moves to the corrected price.
// Stock already taken keeps the price it was taken at, so finished batches do not change.
// Call lockMaterialEverywhere first. Returns the lot the purchase is in afterwards.
export async function repriceUnusedStock(tx: Tx, ref: MaterialRef, purchase: typeof purchaseRecords.$inferSelect, newPrice: string) {
  let left = new Big((await purchaseStockLeft(tx, [purchase])).get(purchase.id) ?? 0).round(3);
  if (left.lte(0)) return purchase.lotId;

  const lotColumn = ref.materialType === "chemical" ? materialLots.chemicalId : materialLots.packagingMaterialId;
  // A purchase from before lots has its stock in an opening lot, beside no other purchase's.
  const inOpeningLot = and(
    eq(lotColumn, ref.materialId),
    exists(tx.select({ id: materialLotMovements.id }).from(materialLotMovements).where(and(
      eq(materialLotMovements.lotId, materialLots.id),
      or(eq(materialLotMovements.sourceType, "opening"), eq(materialLotMovements.sourceId, purchase.id)),
    ))),
  );
  const held = await tx.select({ lotId: materialLots.id, warehouseId: materialLotStock.warehouseId, quantity: materialLotStock.quantity })
    .from(materialLotStock).innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId))
    .where(and(gt(materialLotStock.quantity, "0"), purchase.lotId ? eq(materialLots.id, purchase.lotId) : inOpeningLot))
    .orderBy(asc(materialLots.firstPurchasedAt), asc(materialLots.id), desc(eq(materialLotStock.warehouseId, purchase.warehouseId)), asc(materialLotStock.warehouseId));

  const target = await lotForPurchase(tx, ref, purchase, newPrice);
  let moved = false;
  for (const row of held) {
    const amount = left.lt(row.quantity) ? left : new Big(row.quantity);
    if (amount.lte(0)) break;
    left = left.minus(amount);
    if (row.lotId === target.id) continue; // already at this price
    const move = { ref, warehouseId: row.warehouseId, sourceType: "purchase_edit" as const, sourceId: purchase.id };
    await moveLotStock(tx, { ...move, lotId: row.lotId, delta: amount.times(-1).toFixed(3) });
    await moveLotStock(tx, { ...move, lotId: target.id, delta: amount.toFixed(3) });
    moved = true;
  }
  return moved ? target.id : purchase.lotId;
}

// A lot opened by a correction is as old as the purchase, so oldest-first picking still takes it in turn.
export async function lotForPurchase(tx: Tx, ref: MaterialRef, purchase: { purchaseDate: Date }, unitPrice: string) {
  const lot = await findOrCreateLot(tx, ref, unitPrice);
  if (lot.created) await tx.update(materialLots).set({ firstPurchasedAt: purchase.purchaseDate }).where(eq(materialLots.id, lot.id));
  return lot;
}

// Run after the edit is written. Correcting an older purchase leaves the current price alone.
export async function followEditedPurchase(tx: Tx, ref: MaterialRef, purchaseId: string, unitPrice: string) {
  const [newest] = await newestPurchases(tx, ref);
  if (newest?.id === purchaseId) await setMaterialPrice(tx, ref, unitPrice);
}

// Run before the purchase is removed. A price someone typed in after the purchase is kept.
export async function revertRemovedPurchase(tx: Tx, ref: MaterialRef, purchaseId: string) {
  const [newest, previous] = await newestPurchases(tx, ref);
  if (newest?.id !== purchaseId || !previous) return;
  const table = ref.materialType === "chemical" ? chemicals : packagingMaterials;
  const [item] = await tx.select({ price: table.costPerUnit }).from(table).where(eq(table.id, ref.materialId));
  if (item?.price && lotPrice(item.price) === lotPrice(newest.unitCost)) await setMaterialPrice(tx, ref, previous.unitCost);
}

// What the stock on hand really cost: lots at their own price, and stock from before lots at the current price.
export async function materialStockValue(reader: Pick<typeof db, "select">, materialType: MaterialType) {
  const table = materialType === "chemical" ? chemicals : packagingMaterials;
  const stockColumn = materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId;
  const lotColumn = materialType === "chemical" ? materialLots.chemicalId : materialLots.packagingMaterialId;
  const lots = reader.select({
    warehouseId: materialLotStock.warehouseId,
    materialId: sql<string>`${lotColumn}`.as("material_id"),
    quantity: sql<string>`sum(${materialLotStock.quantity})`.as("lot_quantity"),
    value: sql<string>`sum(${materialLotStock.quantity} * ${materialLots.unitPrice})`.as("lot_value"),
  }).from(materialLotStock).innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId))
    .groupBy(materialLotStock.warehouseId, lotColumn).as("lots");
  const [row] = await reader.select({
    value: sql<string>`coalesce(sum(coalesce(${lots.value}, 0) + (${materialStock.quantity} - coalesce(${lots.quantity}, 0)) * coalesce(${table.costPerUnit}, 0)), 0)`,
  }).from(materialStock).innerJoin(table, eq(table.id, stockColumn))
    .leftJoin(lots, and(eq(lots.warehouseId, materialStock.warehouseId), eq(lots.materialId, stockColumn)));
  return row;
}
