import { desc, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { materialLotStock } from "@/db/schemas/inventory-schema";
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

type PurchaseRow = { id: string; lotId: string | null; quantity: string };

/**
 * Adds how much of each purchase is still in stock, and its latest payment.
 *
 * Purchases at the same price share a lot. Stock used from a lot is taken
 * from its oldest purchases first, so a purchase keeps whatever lot stock is
 * left after the newer purchases in that lot have claimed theirs.
 */
export async function withStockLeft<T extends PurchaseRow>(records: T[]) {
  const lotIds = [...new Set(records.flatMap((r) => (r.lotId ? [r.lotId] : [])))];
  const purchaseIds = records.map((r) => r.id);

  const [lotTotals, newerInLot, payments] = await Promise.all([
    lotIds.length
      ? db
          .select({
            lotId: materialLotStock.lotId,
            quantity: sql<string>`coalesce(sum(${materialLotStock.quantity}), 0)`,
          })
          .from(materialLotStock)
          .where(inArray(materialLotStock.lotId, lotIds))
          .groupBy(materialLotStock.lotId)
      : [],
    lotIds.length
      ? db
          .select({
            id: purchaseRecords.id,
            newer: sql<string>`coalesce(sum(${purchaseRecords.quantity}) over (
              partition by ${purchaseRecords.lotId}
              order by ${purchaseRecords.purchaseDate} desc, ${purchaseRecords.createdAt} desc, ${purchaseRecords.id} desc
              rows between unbounded preceding and 1 preceding
            ), 0)`,
          })
          .from(purchaseRecords)
          .where(inArray(purchaseRecords.lotId, lotIds))
      : [],
    purchaseIds.length
      ? db.query.supplierPayments.findMany({
          where: inArray(supplierPayments.purchaseId, purchaseIds),
          orderBy: [desc(supplierPayments.paymentDate), desc(supplierPayments.createdAt)],
        })
      : [],
  ]);

  const lotTotal = new Map(lotTotals.map((l) => [l.lotId, parseFloat(l.quantity)]));
  const newer = new Map(newerInLot.map((p) => [p.id, parseFloat(p.newer)]));

  return records.map((r) => {
    const stockLeft = r.lotId
      ? Math.min(
          parseFloat(r.quantity),
          Math.max(0, (lotTotal.get(r.lotId) ?? 0) - (newer.get(r.id) ?? 0)),
        )
      : null;
    return {
      ...r,
      stockLeft,
      lastPayment: payments.find((p) => p.purchaseId === r.id) ?? null,
    };
  });
}
