import { and, desc, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { materialLotMovements, materialLotStock, materialLots, materialStock } from "@/db/schemas/inventory-schema";
import { purchaseRecords, supplierPayments } from "@/db/schemas/supplier-schema";
import { reportDateBounds } from "@/lib/report-dates";

/** Day-based date filter in Pakistan time. A lone start date filters that one day. */
export function purchaseDateBounds(dateFrom?: string, dateTo?: string) {
  return reportDateBounds({ dateFrom, dateTo: dateTo ?? dateFrom });
}

/** Newest first, with a stable tie-break so pages never overlap. */
export const purchaseOrder = [
  desc(purchaseRecords.purchaseDate),
  desc(purchaseRecords.createdAt),
  desc(purchaseRecords.id),
];

/** One key per material, so every purchase of a material lands in the same group. */
const groupKey = sql<string>`coalesce(${purchaseRecords.chemicalId}, ${purchaseRecords.packagingMaterialId}, ${purchaseRecords.id})`;

/**
 * One page of purchases, paged by material instead of by purchase.
 *
 * The table shows one group per material, so a page holds `limit` materials
 * with all of their purchases. Paging by purchase split a material across
 * pages and showed it as two separate groups.
 */
export async function purchasesPageByMaterial(where: SQL | undefined, page: number, limit: number) {
  const [{ materials, purchases }] = await db
    .select({
      materials: sql<number>`count(distinct ${groupKey})`,
      purchases: sql<number>`count(*)`,
    })
    .from(purchaseRecords)
    .where(where);

  const latest = sql`max(coalesce(${purchaseRecords.purchaseDate}, ${purchaseRecords.createdAt}))`;
  const pageKeys = await db
    .select({ key: groupKey })
    .from(purchaseRecords)
    .where(where)
    .groupBy(groupKey)
    .orderBy(desc(latest), desc(groupKey))
    .limit(limit)
    .offset((page - 1) * limit);

  const records = pageKeys.length
    ? await db.query.purchaseRecords.findMany({
        where: and(where, inArray(groupKey, pageKeys.map((row) => row.key))),
        with: { warehouse: true, chemical: true, packagingMaterial: true,
          voidedBy: { columns: { name: true } }, voidRefundWallet: { columns: { name: true } } },
        orderBy: purchaseOrder,
      })
    : [];

  return {
    records,
    metadata: {
      totalRecords: Number(purchases),
      totalPages: Math.max(1, Math.ceil(Number(materials) / limit)),
      currentPage: page,
    },
  };
}

type PurchaseRow = {
  id: string;
  lotId: string | null;
  quantity: string;
  chemicalId: string | null;
  packagingMaterialId: string | null;
  voidedAt?: Date | string | null;
};

const materialKey = (r: { chemicalId: string | null; packagingMaterialId: string | null }) =>
  r.chemicalId ? `c:${r.chemicalId}` : r.packagingMaterialId ? `p:${r.packagingMaterialId}` : null;

/** Matches rows of the given materials; null when there are none. */
function materialFilter(
  cols: { chemicalId: any; packagingMaterialId: any },
  chemicalIds: string[],
  packagingIds: string[],
): SQL | undefined {
  const parts = [
    chemicalIds.length ? inArray(cols.chemicalId, chemicalIds) : undefined,
    packagingIds.length ? inArray(cols.packagingMaterialId, packagingIds) : undefined,
  ].filter((p): p is SQL => !!p);
  return parts.length ? or(...parts) : undefined;
}

type Reader = Pick<typeof db, "select">;

/**
 * What a purchase put into the lot it is in now. Less than its quantity when its price was
 * corrected after some was used: only the unused part moved to the new lot.
 */
// Names are spelled out because Drizzle drops table names in one-table selects, which would break the link.
const putInLot = sql<string>`coalesce((
  select sum(moved.delta) from ${materialLotMovements} moved
  where moved.lot_id = ${purchaseRecords}.lot_id and moved.source_id = ${purchaseRecords}.id
    and moved.source_type in ('purchase', 'purchase_edit', 'supplier_return', 'supplier_return_undo')
), ${purchaseRecords}.quantity)`;

/**
 * Stock left for purchases made before lots existed (they have no lot).
 *
 * Their stock is whatever the material holds beyond what lot purchases still
 * claim. It is used from the oldest purchase first, so the newest keeps it.
 */
async function legacyStockLeft(reader: Reader, records: PurchaseRow[]) {
  const legacy = records.filter((r) => !r.voidedAt && !r.lotId && materialKey(r));
  if (!legacy.length) return new Map<string, number>();
  const chemicalIds = [...new Set(legacy.flatMap((r) => (r.chemicalId ? [r.chemicalId] : [])))];
  const packagingIds = [
    ...new Set(legacy.flatMap((r) => (!r.chemicalId && r.packagingMaterialId ? [r.packagingMaterialId] : []))),
  ];

  const [stock, lotStock, lotBought, newerLegacy] = await Promise.all([
    reader
      .select({
        chemicalId: materialStock.chemicalId,
        packagingMaterialId: materialStock.packagingMaterialId,
        quantity: sql<string>`coalesce(sum(${materialStock.quantity}), 0)`,
      })
      .from(materialStock)
      .where(materialFilter(materialStock, chemicalIds, packagingIds))
      .groupBy(materialStock.chemicalId, materialStock.packagingMaterialId),
    reader
      .select({
        lotId: materialLots.id,
        chemicalId: materialLots.chemicalId,
        packagingMaterialId: materialLots.packagingMaterialId,
        quantity: sql<string>`coalesce(sum(${materialLotStock.quantity}), 0)`,
      })
      .from(materialLots)
      .leftJoin(materialLotStock, sql`${materialLotStock.lotId} = ${materialLots.id}`)
      .where(materialFilter(materialLots, chemicalIds, packagingIds))
      .groupBy(materialLots.id),
    reader
      .select({
        lotId: purchaseRecords.lotId,
        quantity: sql<string>`coalesce(sum(${putInLot}), 0)`,
      })
      .from(purchaseRecords)
      .where(and(isNull(purchaseRecords.voidedAt), isNotNull(purchaseRecords.lotId), materialFilter(purchaseRecords, chemicalIds, packagingIds)))
      .groupBy(purchaseRecords.lotId),
    reader
      .select({
        id: purchaseRecords.id,
        newer: sql<string>`coalesce(sum(${purchaseRecords.quantity}) over (
          partition by ${purchaseRecords.chemicalId}, ${purchaseRecords.packagingMaterialId}
          order by ${purchaseRecords.purchaseDate} desc, ${purchaseRecords.createdAt} desc, ${purchaseRecords.id} desc
          rows between unbounded preceding and 1 preceding
        ), 0)`,
      })
      .from(purchaseRecords)
      .where(and(isNull(purchaseRecords.voidedAt), isNull(purchaseRecords.lotId), materialFilter(purchaseRecords, chemicalIds, packagingIds))),
  ]);

  // Free stock per material: total stock, less what each lot's purchases still hold.
  const free = new Map<string, number>();
  for (const s of stock) {
    const key = materialKey(s);
    if (key) free.set(key, (free.get(key) ?? 0) + parseFloat(s.quantity));
  }
  const bought = new Map(lotBought.map((b) => [b.lotId, parseFloat(b.quantity)]));
  for (const lot of lotStock) {
    const key = materialKey(lot);
    if (!key) continue;
    const held = Math.min(parseFloat(lot.quantity), bought.get(lot.lotId) ?? 0);
    free.set(key, (free.get(key) ?? 0) - held);
  }

  const newer = new Map(newerLegacy.map((p) => [p.id, parseFloat(p.newer)]));
  return new Map(
    legacy.map((r) => [
      r.id,
      Math.min(
        parseFloat(r.quantity),
        Math.max(0, (free.get(materialKey(r)!) ?? 0) - (newer.get(r.id) ?? 0)),
      ),
    ]),
  );
}

/**
 * How much of each purchase is still in stock.
 *
 * Purchases at the same price share a lot. Stock used from a lot is taken
 * from its oldest purchases first, so a purchase keeps whatever lot stock is
 * left after the newer purchases in that lot have claimed theirs. Purchases
 * from before lots get theirs from the material's stock outside lot purchases.
 */
export async function purchaseStockLeft(reader: Reader, records: PurchaseRow[]) {
  const lotIds = [...new Set(records.flatMap((r) => (r.lotId ? [r.lotId] : [])))];
  const [lotTotals, newerInLot, legacyLeft] = await Promise.all([
    lotIds.length
      ? reader
          .select({
            lotId: materialLotStock.lotId,
            quantity: sql<string>`coalesce(sum(${materialLotStock.quantity}), 0)`,
          })
          .from(materialLotStock)
          .where(inArray(materialLotStock.lotId, lotIds))
          .groupBy(materialLotStock.lotId)
      : [],
    lotIds.length
      ? reader
          .select({
            id: purchaseRecords.id,
            own: putInLot,
            newer: sql<string>`coalesce(sum(${putInLot}) over (
              partition by ${purchaseRecords.lotId}
              order by ${purchaseRecords.purchaseDate} desc, ${purchaseRecords.createdAt} desc, ${purchaseRecords.id} desc
              rows between unbounded preceding and 1 preceding
            ), 0)`,
          })
          .from(purchaseRecords)
          .where(and(isNull(purchaseRecords.voidedAt), inArray(purchaseRecords.lotId, lotIds)))
      : [],
    legacyStockLeft(reader, records),
  ]);

  const lotTotal = new Map(lotTotals.map((l) => [l.lotId, parseFloat(l.quantity)]));
  const inLot = new Map(newerInLot.map((p) => [p.id, p]));
  return new Map<string, number | null>(
    records.map((r) => {
      if (r.voidedAt) return [r.id, 0];
      if (!r.lotId) return [r.id, legacyLeft.get(r.id) ?? null];
      const row = inLot.get(r.id);
      return [
        r.id,
        Math.min(
          parseFloat(row?.own ?? r.quantity),
          Math.max(0, (lotTotal.get(r.lotId) ?? 0) - parseFloat(row?.newer ?? "0")),
        ),
      ];
    }),
  );
}

/** Adds how much of each purchase is still in stock, and its latest payment. */
export async function withStockLeft<T extends PurchaseRow>(records: T[]) {
  const purchaseIds = records.map((r) => r.id);
  const [left, payments] = await Promise.all([
    purchaseStockLeft(db, records),
    purchaseIds.length
      ? db.query.supplierPayments.findMany({
          where: inArray(supplierPayments.purchaseId, purchaseIds),
          orderBy: [desc(supplierPayments.paymentDate), desc(supplierPayments.createdAt)],
        })
      : [],
  ]);
  return records.map((r) => ({
    ...r,
    stockLeft: left.get(r.id) ?? null,
    lastPayment: payments.find((p) => p.purchaseId === r.id) ?? null,
  }));
}
