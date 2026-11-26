import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { commissionRecords, commissionTiers, orderBookers, orders } from "@/db/schemas/sales-erp-schema";
import { calculateOrderBookerCommission } from "@/lib/order-booker/commission";
import type { CommissionMode } from "@/lib/order-booker/recovery-commission";
import { roundMoney } from "@/lib/sales/settlement/money";
import type { SalesTransaction } from "./settlement-service";

export type OrderCommissionTerms = { mode: CommissionMode; rate: number };

/** Same tier lookup as delivery commission used: booker tiers, then global tiers, then the flat rate. */
async function resolveDeliveryRate(tx: SalesTransaction, orderBookerId: string, deliveredAmount: number): Promise<number> {
  let tiers = await tx.query.commissionTiers.findMany({
    where: and(eq(commissionTiers.orderBookerId, orderBookerId), eq(commissionTiers.isActive, true)),
    orderBy: [commissionTiers.minAmount],
  });
  if (tiers.length === 0) {
    tiers = await tx.query.commissionTiers.findMany({
      where: and(isNull(commissionTiers.orderBookerId), eq(commissionTiers.isActive, true)),
      orderBy: [commissionTiers.minAmount],
    });
  }
  let flatRate = 0;
  if (tiers.length === 0) {
    const booker = await tx.query.orderBookers.findFirst({ where: eq(orderBookers.id, orderBookerId), columns: { commissionRate: true } });
    flatRate = Number(booker?.commissionRate ?? 0);
  }
  const result = calculateOrderBookerCommission({ fulfilledAmount: deliveredAmount, tiers, flatRate });
  if (result.mode === "flat") return result.rate;
  return deliveredAmount > 0 ? Math.round((result.amount / deliveredAmount) * 100 * 10000) / 10000 : 0;
}

const termsOf = (row: { commissionMode: string | null; commissionRateLocked: string | null }): OrderCommissionTerms | null =>
  row.commissionMode ? { mode: row.commissionMode as CommissionMode, rate: Number(row.commissionRateLocked ?? 0) } : null;

/** Locks the rate the first time an order is delivered. Later deliveries (fulfil, then invoice) keep it. */
export async function lockOrderCommissionTerms(
  tx: SalesTransaction,
  input: { orderId: string; orderBookerId: string; deliveredAmount: number; policy: "normal" | "suppress" },
): Promise<OrderCommissionTerms> {
  const [current] = await tx.select({ commissionMode: orders.commissionMode, commissionRateLocked: orders.commissionRateLocked })
    .from(orders).where(eq(orders.id, input.orderId)).for("update");
  const existing = current && termsOf(current);
  if (existing) return existing;
  const rate = input.policy === "suppress" ? 0 : await resolveDeliveryRate(tx, input.orderBookerId, input.deliveredAmount);
  const mode: CommissionMode = input.policy === "suppress" ? "suppressed" : "recovery";
  await tx.update(orders).set({ commissionMode: mode, commissionRateLocked: rate.toFixed(4), updatedAt: new Date() }).where(eq(orders.id, input.orderId));
  return { mode, rate };
}

/** Effective rate of an old delivery record: commission ÷ delivered × 100. */
const legacyRate = (record: { commissionAmount: string; fulfilledAmount: string }) =>
  Number(record.fulfilledAmount) > 0 ? Math.round((Number(record.commissionAmount) / Number(record.fulfilledAmount)) * 100 * 10000) / 10000 : 0;

/** Moves one old (pre-phase-6) delivered order over to recovery terms. Returns null for orders not delivered yet. */
export async function resolveOrderCommissionTerms(tx: SalesTransaction, orderId: string): Promise<OrderCommissionTerms | null> {
  const [order] = await tx.select({ id: orders.id, status: orders.status, commissionMode: orders.commissionMode, commissionRateLocked: orders.commissionRateLocked })
    .from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) return null;
  const existing = termsOf(order);
  if (existing) return existing;
  const hasInvoice = (await tx.execute(sql`select 1 from invoices where order_id = ${orderId} and status = 'saved' limit 1`)).rows.length > 0;
  if (order.status !== "delivered" && !hasInvoice) return null;

  const records = await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, orderId));
  const paid = records.find((r) => r.status === "paid");
  const accrued = records.find((r) => r.status === "accrued");
  let terms: OrderCommissionTerms;
  if (paid) terms = { mode: "delivery_paid", rate: legacyRate(paid) };
  else if (accrued) {
    terms = { mode: "recovery", rate: legacyRate(accrued) };
    await tx.update(commissionRecords).set({ status: "cancelled", updatedAt: new Date() }).where(eq(commissionRecords.id, accrued.id));
  } else terms = { mode: "suppressed", rate: 0 };
  await tx.update(orders).set({ commissionMode: terms.mode, commissionRateLocked: terms.rate.toFixed(4), updatedAt: new Date() }).where(eq(orders.id, orderId));
  return terms;
}

let switchoverDone = false;
/** Moves every old delivered order over. Runs before payroll and the commission screens read. Idempotent. */
export async function ensureRecoveryCommissionSwitchover(): Promise<void> {
  if (switchoverDone) return;
  const { db } = await import("@/db");
  await db.transaction(async (tx) => {
    const pending = await tx.execute(sql`
      select o.id from orders o
      where o.commission_mode is null
        and (o.status = 'delivered' or exists (select 1 from invoices i where i.order_id = o.id and i.status = 'saved'))`);
    for (const row of pending.rows as Array<{ id: string }>) {
      await resolveOrderCommissionTerms(tx as unknown as SalesTransaction, row.id);
    }
  });
  switchoverDone = true;
}

/** Test-only: lets integration tests run the bulk switch-over again. */
export function resetRecoveryCommissionSwitchoverForTests() {
  switchoverDone = false;
}

export { roundMoney as _roundMoney, inArray as _inArray };
