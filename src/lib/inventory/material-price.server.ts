import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import Big from "big.js";
import type { db } from "@/db";
import { chemicals, materialLots, materialLotStock, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { lotPrice, type MaterialRef, type MaterialType } from "./material-lots";
import { lockMaterialStock, type Tx } from "./material-lots.server";

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
