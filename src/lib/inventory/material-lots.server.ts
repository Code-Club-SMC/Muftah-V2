// src/lib/inventory/material-lots.server.ts
import Big from "big.js";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { db } from "@/db";
import { chemicals, materialLotMovements, materialLots, materialLotStock, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { checkLotPicks, costLotPicks, lotPrice, lotQuantity, type LotBalance, type LotPick, type MaterialRef, type PickedLot } from "./material-lots";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LotSourceType = "opening" | "purchase" | "purchase_edit" | "purchase_delete" | "transfer_out" | "transfer_in" | "mixing" | "packing" | "recovery" | "adjustment" | "warehouse_close";

const stockColumn = (ref: MaterialRef) => (ref.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId);
const lotColumn = (ref: MaterialRef) => (ref.materialType === "chemical" ? materialLots.chemicalId : materialLots.packagingMaterialId);
const refValues = (ref: MaterialRef) => ({ chemicalId: ref.materialType === "chemical" ? ref.materialId : null, packagingMaterialId: ref.materialType === "packaging" ? ref.materialId : null });

// Lock order: warehouse id, then material type, then material id. Every writer uses this order.
export async function lockMaterialStock(tx: Tx, warehouseIds: string[], refs: MaterialRef[]) {
  const stores = [...new Set(warehouseIds)].sort();
  const items = [...new Map(refs.map((ref) => [`${ref.materialType}:${ref.materialId}`, ref])).values()]
    .sort((a, b) => `${a.materialType}:${a.materialId}`.localeCompare(`${b.materialType}:${b.materialId}`));
  for (const warehouseId of stores) {
    for (const ref of items) {
      const [row] = await tx.select().from(materialStock)
        .where(and(eq(materialStock.warehouseId, warehouseId), eq(stockColumn(ref), ref.materialId)))
        .for("update");
      if (row) await reconcileOpeningLot(tx, warehouseId, ref, row.quantity);
    }
  }
}

async function lotSum(tx: Tx, warehouseId: string, ref: MaterialRef) {
  const [row] = await tx.select({ total: sql<string>`coalesce(sum(${materialLotStock.quantity}), 0)` })
    .from(materialLotStock).innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId))
    .where(and(eq(materialLotStock.warehouseId, warehouseId), eq(lotColumn(ref), ref.materialId)));
  return new Big(row?.total ?? 0);
}

// Stock recorded before lots existed becomes one lot at the item's current price.
async function reconcileOpeningLot(tx: Tx, warehouseId: string, ref: MaterialRef, itemTotal: string) {
  const missing = new Big(itemTotal).minus(await lotSum(tx, warehouseId, ref));
  if (missing.eq(0)) return;
  if (missing.lt(0)) throw new Error("Lot stock disagrees with item stock. Contact support before moving this item.");
  const table = ref.materialType === "chemical" ? chemicals : packagingMaterials;
  const [item] = await tx.select({ price: table.costPerUnit }).from(table).where(eq(table.id, ref.materialId));
  const lot = await findOrCreateLot(tx, ref, item?.price ?? "0");
  await addLotQuantity(tx, lot.id, warehouseId, missing.toFixed(3));
  await tx.insert(materialLotMovements).values({ lotId: lot.id, warehouseId, delta: missing.toFixed(3), sourceType: "opening" });
}

export async function findOrCreateLot(tx: Tx, ref: MaterialRef, unitPrice: string) {
  const price = lotPrice(unitPrice);
  const [inserted] = await tx.insert(materialLots).values({ ...refValues(ref), unitPrice: price })
    .onConflictDoNothing().returning({ id: materialLots.id, unitPrice: materialLots.unitPrice });
  if (inserted) return { ...inserted, created: true };
  const [existing] = await tx.select({ id: materialLots.id, unitPrice: materialLots.unitPrice }).from(materialLots)
    .where(and(eq(lotColumn(ref), ref.materialId), eq(materialLots.unitPrice, price)));
  if (!existing) throw new Error("Price lot could not be created");
  return { ...existing, created: false };
}

async function addLotQuantity(tx: Tx, lotId: string, warehouseId: string, quantity: string) {
  await tx.insert(materialLotStock).values({ lotId, warehouseId, quantity })
    .onConflictDoUpdate({ target: [materialLotStock.lotId, materialLotStock.warehouseId], set: { quantity: sql`${materialLotStock.quantity} + ${quantity}`, updatedAt: new Date() } });
}

export async function moveLotStock(tx: Tx, input: { ref: MaterialRef; lotId: string; warehouseId: string; delta: string; sourceType: LotSourceType; sourceId?: string | null }) {
  const delta = new Big(input.delta);
  if (delta.eq(0)) return;
  const amount = lotQuantity(delta.abs().toString());
  const column = stockColumn(input.ref);
  if (delta.gt(0)) {
    await addLotQuantity(tx, input.lotId, input.warehouseId, amount);
    await tx.insert(materialStock).values({ warehouseId: input.warehouseId, ...refValues(input.ref), quantity: amount })
      .onConflictDoUpdate({ target: [materialStock.warehouseId, column], targetWhere: sql`${column} IS NOT NULL`, set: { quantity: sql`${materialStock.quantity} + ${amount}`, updatedAt: new Date() } });
  } else {
    const [debited] = await tx.update(materialLotStock)
      .set({ quantity: sql`${materialLotStock.quantity} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(materialLotStock.lotId, input.lotId), eq(materialLotStock.warehouseId, input.warehouseId), gte(materialLotStock.quantity, amount)))
      .returning({ id: materialLotStock.id });
    if (!debited) throw new Error("Not enough stock in this lot");
    const [total] = await tx.update(materialStock)
      .set({ quantity: sql`${materialStock.quantity} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(materialStock.warehouseId, input.warehouseId), eq(column, input.ref.materialId), gte(materialStock.quantity, amount)))
      .returning({ id: materialStock.id });
    if (!total) throw new Error("Lot stock disagrees with item stock. Contact support before moving this item.");
  }
  await tx.insert(materialLotMovements).values({ lotId: input.lotId, warehouseId: input.warehouseId, delta: delta.toFixed(3), sourceType: input.sourceType, sourceId: input.sourceId ?? null });
}

export async function listLotBalances(tx: Tx, warehouseId: string, ref: MaterialRef): Promise<LotBalance[]> {
  const rows = await tx.select({ lotId: materialLots.id, unitPrice: materialLots.unitPrice, quantity: materialLotStock.quantity, firstPurchasedAt: materialLots.firstPurchasedAt })
    .from(materialLotStock).innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId))
    .where(and(eq(materialLotStock.warehouseId, warehouseId), eq(lotColumn(ref), ref.materialId), sql`${materialLotStock.quantity} > 0`))
    .orderBy(asc(materialLots.firstPurchasedAt), asc(materialLots.unitPrice), asc(materialLots.id));
  return rows;
}

export async function takeLotPicks(tx: Tx, input: { warehouseId: string; ref: MaterialRef; name: string; unit: string; required: string; picks: LotPick[]; sourceType: LotSourceType; sourceId?: string | null }): Promise<PickedLot[]> {
  const balances = await listLotBalances(tx, input.warehouseId, input.ref);
  const errors = checkLotPicks({ name: input.name, unit: input.unit, required: input.required, picks: input.picks, balances });
  if (errors.length) throw new Error(errors.join("; "));
  const picked = costLotPicks(input.picks, balances);
  for (const row of picked) await moveLotStock(tx, { ref: input.ref, lotId: row.lotId, warehouseId: input.warehouseId, delta: new Big(row.quantity).times(-1).toString(), sourceType: input.sourceType, sourceId: input.sourceId });
  return picked;
}

export async function relocateAllLots(tx: Tx, input: { fromWarehouseId: string; toWarehouseId: string; ref: MaterialRef; sourceId: string }) {
  const balances = await listLotBalances(tx, input.fromWarehouseId, input.ref);
  const picked = costLotPicks(balances.map((row) => ({ lotId: row.lotId, quantity: row.quantity })), balances);
  for (const row of picked) {
    await moveLotStock(tx, { ref: input.ref, lotId: row.lotId, warehouseId: input.fromWarehouseId, delta: `-${row.quantity}`, sourceType: "warehouse_close", sourceId: input.sourceId });
    await moveLotStock(tx, { ref: input.ref, lotId: row.lotId, warehouseId: input.toWarehouseId, delta: row.quantity, sourceType: "warehouse_close", sourceId: input.sourceId });
  }
  return picked;
}
