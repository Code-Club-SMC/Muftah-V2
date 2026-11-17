// src/lib/inventory/by-products.server.ts
import Big from "big.js";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { otherIncome } from "@/db/schemas/finance-schema";
import { chemicals, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import type { MaterialRef } from "./material-lots";
import type { Tx } from "./material-lots.server";
import { packagingUnit } from "./material-units";
import { byProductLabel, containerKey, earnedEmpties } from "./by-products";

type Reader = Tx | typeof db;

export type ByProductSummary = {
  key: string;
  materialType: "chemical" | "packaging";
  materialId: string;
  itemName: string;
  unit: string;
  containerName: string;
  containerSize: string;
  label: string;
  earned: number;
  sold: number;
  inHand: number;
};

/** Serializes sales and purchase changes for one item. Always taken after any lockMaterialStock call. */
export async function lockByProductMaterial(tx: Tx, ref: MaterialRef) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('by-product:' || ${ref.materialType} || ':' || ${ref.materialId}))`,
  );
}

const purchaseColumn = (ref: MaterialRef) =>
  ref.materialType === "chemical" ? purchaseRecords.chemicalId : purchaseRecords.packagingMaterialId;
const stockColumn = (ref: MaterialRef) =>
  ref.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId;
const saleColumn = (ref: MaterialRef) =>
  ref.materialType === "chemical" ? otherIncome.chemicalId : otherIncome.packagingMaterialId;

async function itemNameAndUnit(reader: Reader, ref: MaterialRef) {
  if (ref.materialType === "chemical") {
    const [row] = await reader.select({ name: chemicals.name, unit: chemicals.unit }).from(chemicals).where(eq(chemicals.id, ref.materialId));
    return { name: row?.name ?? "Unknown item", unit: row?.unit || "kg" };
  }
  const [row] = await reader
    .select({ name: packagingMaterials.name, measuredInKg: packagingMaterials.measuredInKg })
    .from(packagingMaterials)
    .where(eq(packagingMaterials.id, ref.materialId));
  return { name: row?.name ?? "Unknown item", unit: packagingUnit(row) };
}

export async function loadItemByProducts(reader: Reader, ref: MaterialRef): Promise<ByProductSummary[]> {
  const purchases = await reader
    .select({
      quantity: purchaseRecords.quantity,
      byProductTracked: purchaseRecords.byProductTracked,
      containerName: purchaseRecords.containerName,
      containerSize: purchaseRecords.containerSize,
    })
    .from(purchaseRecords)
    .where(and(eq(purchaseColumn(ref), ref.materialId), isNull(purchaseRecords.voidedAt)))
    .orderBy(asc(purchaseRecords.purchaseDate), asc(purchaseRecords.createdAt));

  const [stock] = await reader
    .select({ total: sql<string>`coalesce(sum(${materialStock.quantity}), 0)` })
    .from(materialStock)
    .where(eq(stockColumn(ref), ref.materialId));

  const sales = await reader
    .select({
      containerName: otherIncome.containerName,
      containerSize: otherIncome.containerSize,
      sold: sql<string>`sum(${otherIncome.quantity})`,
    })
    .from(otherIncome)
    .where(and(eq(saleColumn(ref), ref.materialId), isNull(otherIncome.voidedAt)))
    .groupBy(otherIncome.containerName, otherIncome.containerSize);

  const earned = earnedEmpties({ inStock: String(stock?.total ?? "0"), purchases });
  const { name, unit } = await itemNameAndUnit(reader, ref);

  const rows = new Map<string, ByProductSummary>();
  const row = (containerName: string, containerSize: string) => {
    const key = containerKey(containerName, containerSize);
    const existing = rows.get(key);
    if (existing) return existing;
    const created: ByProductSummary = {
      key: `${ref.materialType}:${ref.materialId}:${key}`,
      materialType: ref.materialType,
      materialId: ref.materialId,
      itemName: name,
      unit,
      containerName,
      containerSize: new Big(containerSize).toFixed(3),
      label: byProductLabel(name, unit, containerName, containerSize),
      earned: 0,
      sold: 0,
      inHand: 0,
    };
    rows.set(key, created);
    return created;
  };
  for (const entry of earned.values()) row(entry.containerName, entry.containerSize).earned = entry.earned;
  for (const sale of sales) row(sale.containerName, sale.containerSize).sold = Number(new Big(sale.sold).toFixed(0));
  for (const summary of rows.values()) summary.inHand = summary.earned - summary.sold;
  return [...rows.values()];
}

/** Run inside the transaction, after the change is written. */
export async function assertEarnedCoversSold(tx: Tx, ref: MaterialRef) {
  await lockByProductMaterial(tx, ref);
  for (const row of await loadItemByProducts(tx, ref)) {
    if (row.sold > row.earned) {
      throw new Error(`${row.sold} ${row.label} already sold; this change would leave only ${row.earned} earned`);
    }
  }
}

export async function listByProducts(): Promise<ByProductSummary[]> {
  const tracked = await db
    .selectDistinct({ chemicalId: purchaseRecords.chemicalId, packagingMaterialId: purchaseRecords.packagingMaterialId })
    .from(purchaseRecords)
    .where(and(eq(purchaseRecords.byProductTracked, true), isNull(purchaseRecords.voidedAt)));
  const sold = await db
    .selectDistinct({ chemicalId: otherIncome.chemicalId, packagingMaterialId: otherIncome.packagingMaterialId })
    .from(otherIncome)
    .where(or(isNotNull(otherIncome.chemicalId), isNotNull(otherIncome.packagingMaterialId)));

  const refs = new Map<string, MaterialRef>();
  for (const item of [...tracked, ...sold]) {
    const ref: MaterialRef = item.chemicalId
      ? { materialType: "chemical", materialId: item.chemicalId }
      : { materialType: "packaging", materialId: item.packagingMaterialId! };
    refs.set(`${ref.materialType}:${ref.materialId}`, ref);
  }

  const all = (await Promise.all([...refs.values()].map((ref) => loadItemByProducts(db, ref)))).flat();
  return all
    .filter((row) => row.earned !== 0 || row.sold !== 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}
