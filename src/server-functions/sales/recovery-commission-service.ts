import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { commissionEarnings, commissionRecords, commissionTiers, orderBookers, orders, payments, salesReturns } from "@/db/schemas/sales-erp-schema";
import { invoices } from "@/db/schemas/sales-schema";
import { calculateOrderBookerCommission } from "@/lib/order-booker/commission";
import {
  clawbackBase,
  commissionAmount,
  earnableBase,
  paymentEarnsCommission,
  settlePayslipCommission,
  type BookerMonthInput,
  type CommissionBearer,
  type CommissionMode,
  type PayslipCommissionSettlement,
  type RecoveryCommissionBreakdown,
} from "@/lib/order-booker/recovery-commission";
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

/** What the customer really owes on the invoice: total minus the value of completed returns. */
export async function owedOnInvoice(tx: SalesTransaction, invoiceId: string): Promise<number> {
  const [row] = await tx.select({
    total: invoices.totalPrice,
    returned: sql<string>`coalesce((select sum(${salesReturns.totalAmount}) from ${salesReturns}
      where ${salesReturns.invoiceId} = ${invoiceId} and ${salesReturns.status} = 'completed'), 0)`,
  }).from(invoices).where(eq(invoices.id, invoiceId));
  return roundMoney(Math.max(0, Number(row?.total ?? 0) - Number(row?.returned ?? 0)));
}

/** Money on this invoice that commission has already been worked out on (net of reversals and take-backs). */
export async function commissionedBase(tx: SalesTransaction, invoiceId: string): Promise<number> {
  const [row] = await tx.select({ base: sql<string>`coalesce(sum(${commissionEarnings.baseAmount}), 0)` })
    .from(commissionEarnings).where(eq(commissionEarnings.invoiceId, invoiceId));
  return roundMoney(Number(row?.base ?? 0));
}

type InvoiceCommissionContext = { orderId: string; orderBookerId: string; terms: OrderCommissionTerms };

async function invoiceCommissionContext(tx: SalesTransaction, invoiceId: string): Promise<InvoiceCommissionContext | null> {
  const invoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId), columns: { orderId: true, orderBookerId: true } });
  if (!invoice?.orderId || !invoice.orderBookerId) return null;
  const terms = await resolveOrderCommissionTerms(tx, invoice.orderId);
  if (!terms || terms.mode !== "recovery" || terms.rate <= 0) return null;
  return { orderId: invoice.orderId, orderBookerId: invoice.orderBookerId, terms };
}

/** Called right after a payment becomes confirmed (the wallet is credited at the same point). */
export async function earnCommissionForPayment(
  tx: SalesTransaction,
  payment: { id: string; invoiceId: string; amount: string; method: string; status: string; effectiveDate: Date | null },
  actorId: string,
): Promise<void> {
  if (payment.status !== "confirmed" || !payment.effectiveDate || !paymentEarnsCommission(payment.method)) return;
  const context = await invoiceCommissionContext(tx, payment.invoiceId);
  if (!context) return;
  const base = earnableBase({
    paymentAmount: Number(payment.amount),
    owed: await owedOnInvoice(tx, payment.invoiceId),
    commissionedBase: await commissionedBase(tx, payment.invoiceId),
  });
  if (base <= 0) return;
  await tx.insert(commissionEarnings).values({
    orderBookerId: context.orderBookerId,
    orderId: context.orderId,
    invoiceId: payment.invoiceId,
    paymentId: payment.id,
    kind: "payment",
    baseAmount: base.toFixed(2),
    rate: context.terms.rate.toFixed(4),
    amount: commissionAmount(base, context.terms.rate).toFixed(2),
    entryDate: payment.effectiveDate,
    createdById: actorId,
  }).onConflictDoNothing();
}

/** A reversed payment either takes its commission back from the booker or records that the company bears it. */
export async function reverseCommissionForPayment(
  tx: SalesTransaction,
  input: { paymentId: string; bearer: CommissionBearer; actorId: string; date: Date; reason: string },
): Promise<void> {
  const earned = await tx.query.commissionEarnings.findFirst({
    where: and(eq(commissionEarnings.paymentId, input.paymentId), eq(commissionEarnings.kind, "payment")),
  });
  if (!earned) return;
  const deduct = input.bearer === "booker";
  await tx.insert(commissionEarnings).values({
    orderBookerId: earned.orderBookerId,
    orderId: earned.orderId,
    invoiceId: earned.invoiceId,
    paymentId: input.paymentId,
    kind: "payment_reversal",
    bearer: input.bearer,
    baseAmount: deduct ? (-Number(earned.baseAmount)).toFixed(2) : "0.00",
    rate: earned.rate,
    amount: deduct ? (-Number(earned.amount)).toFixed(2) : "0.00",
    entryDate: input.date,
    createdById: input.actorId,
    note: input.reason,
  }).onConflictDoNothing();
}

/** Commission a confirmed payment earned. Null when it earned nothing or was already reversed. */
export async function getPaymentCommission(tx: SalesTransaction, paymentId: string): Promise<{ amount: number; orderBookerName: string } | null> {
  const rows = await tx.query.commissionEarnings.findMany({
    where: eq(commissionEarnings.paymentId, paymentId),
    with: { orderBooker: { columns: { name: true } } },
  });
  const earned = rows.find((r) => r.kind === "payment");
  if (!earned || rows.some((r) => r.kind === "payment_reversal")) return null;
  return { amount: Number(earned.amount), orderBookerName: earned.orderBooker.name };
}

/** After a return completes: if money already commissioned is above what is now owed, take back the difference. */
export async function capCommissionAfterReturn(
  tx: SalesTransaction,
  input: { invoiceId: string; salesReturnId: string; actorId: string; date: Date },
): Promise<void> {
  const base = clawbackBase({ owed: await owedOnInvoice(tx, input.invoiceId), commissionedBase: await commissionedBase(tx, input.invoiceId) });
  if (base <= 0) return;
  // Every row on an invoice carries the order's single locked rate.
  const latest = await tx.query.commissionEarnings.findFirst({
    where: and(eq(commissionEarnings.invoiceId, input.invoiceId), eq(commissionEarnings.kind, "payment")),
    orderBy: (row, { desc }) => [desc(row.createdAt)],
  });
  if (!latest) return;
  await tx.insert(commissionEarnings).values({
    orderBookerId: latest.orderBookerId,
    orderId: latest.orderId,
    invoiceId: input.invoiceId,
    salesReturnId: input.salesReturnId,
    kind: "return_clawback",
    baseAmount: (-base).toFixed(2),
    rate: latest.rate,
    amount: (-commissionAmount(base, Number(latest.rate))).toFixed(2),
    entryDate: input.date,
    createdById: input.actorId,
  }).onConflictDoNothing();
}

/** A voided return gives back exactly what it took. */
export async function restoreCommissionAfterReturnVoid(
  tx: SalesTransaction,
  input: { salesReturnId: string; actorId: string; date: Date },
): Promise<void> {
  const taken = await tx.query.commissionEarnings.findFirst({
    where: and(eq(commissionEarnings.salesReturnId, input.salesReturnId), eq(commissionEarnings.kind, "return_clawback")),
  });
  if (!taken) return;
  await tx.insert(commissionEarnings).values({
    orderBookerId: taken.orderBookerId,
    orderId: taken.orderId,
    invoiceId: taken.invoiceId,
    salesReturnId: input.salesReturnId,
    kind: "return_clawback_undo",
    baseAmount: (-Number(taken.baseAmount)).toFixed(2),
    rate: taken.rate,
    amount: (-Number(taken.amount)).toFixed(2),
    entryDate: input.date,
    createdById: input.actorId,
  }).onConflictDoNothing();
}

/** Every unpaid ledger row dated before the end of the pay period, with the payslip outcome. */
export async function collectPayslipCommission(
  tx: SalesTransaction,
  orderBookerId: string,
  periodEndExclusive: Date,
): Promise<{ entryIds: string[]; settlement: PayslipCommissionSettlement; breakdown: RecoveryCommissionBreakdown }> {
  const rows = await tx.query.commissionEarnings.findMany({
    where: and(
      eq(commissionEarnings.orderBookerId, orderBookerId),
      isNull(commissionEarnings.paidInPayslipId),
      lt(commissionEarnings.entryDate, periodEndExclusive),
    ),
    with: { invoice: { columns: { invoiceNumber: true } } },
    orderBy: (row, { asc }) => [asc(row.entryDate), asc(row.createdAt)],
  });
  const settlement = settlePayslipCommission(rows.map((r) => ({ amount: Number(r.amount) })));
  return {
    entryIds: rows.map((r) => r.id),
    settlement,
    breakdown: {
      kind: "recovery",
      paymentsCount: rows.filter((r) => r.kind === "payment").length,
      earned: settlement.earned,
      deductions: settlement.deductions,
      carriedForward: settlement.carriedForward,
      lines: rows.map((r) => ({
        entryDate: r.entryDate.toISOString().slice(0, 10),
        invoiceNumber: String(r.invoice?.invoiceNumber ?? r.invoiceId.slice(0, 8)),
        kind: r.kind,
        base: Number(r.baseAmount),
        rate: Number(r.rate),
        amount: Number(r.amount),
      })),
    },
  };
}

export async function markPayslipCommissionPaid(tx: SalesTransaction, entryIds: string[], payslipId: string): Promise<void> {
  if (entryIds.length === 0) return;
  const updated = await tx.update(commissionEarnings).set({ paidInPayslipId: payslipId })
    .where(and(inArray(commissionEarnings.id, entryIds), isNull(commissionEarnings.paidInPayslipId)))
    .returning({ id: commissionEarnings.id });
  if (updated.length !== entryIds.length) {
    throw new Error("Commission entries changed during payroll generation. Please recalculate the payslip.");
  }
}

/** A deleted payslip frees its rows so the next payslip pays them again. */
export async function releasePayslipCommission(tx: SalesTransaction, payslipId: string): Promise<void> {
  await tx.update(commissionEarnings).set({ paidInPayslipId: null }).where(eq(commissionEarnings.paidInPayslipId, payslipId));
}

/** Raw rows for the commission screens, grouped per booker. Invoices up to month end; entries inside the month. */
export async function loadBookerMonthInputs(
  tx: SalesTransaction,
  input: { orderBookerIds: string[] | "all"; monthStart: Date; monthEnd: Date },
): Promise<Map<string, BookerMonthInput>> {
  const map = new Map<string, BookerMonthInput>();
  if (input.orderBookerIds !== "all" && input.orderBookerIds.length === 0) return map;
  const bookerFilter = input.orderBookerIds === "all" ? sql`${invoices.orderBookerId} is not null` : inArray(invoices.orderBookerId, input.orderBookerIds);
  const invoiceRows = await tx.select({
    id: invoices.id, orderBookerId: invoices.orderBookerId, date: invoices.date, totalPrice: invoices.totalPrice,
    mode: orders.commissionMode, rate: orders.commissionRateLocked,
  }).from(invoices).leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(and(bookerFilter, eq(invoices.status, "saved"), lte(invoices.date, input.monthEnd)));
  const bucket = (bookerId: string) => {
    let entry = map.get(bookerId);
    if (!entry) {
      entry = { monthStart: input.monthStart, monthEnd: input.monthEnd, invoices: [], returns: [], payments: [], entries: [] };
      map.set(bookerId, entry);
    }
    return entry;
  };
  const bookerOf = new Map(invoiceRows.map((r) => [r.id, r.orderBookerId as string]));
  for (const r of invoiceRows) {
    bucket(r.orderBookerId as string).invoices.push({
      id: r.id, date: r.date, totalPrice: Number(r.totalPrice),
      mode: (r.mode as CommissionMode | null) ?? null, rate: r.rate === null ? null : Number(r.rate),
    });
  }
  const ids = invoiceRows.map((r) => r.id);
  if (ids.length > 0) {
    const returnRows = await tx.select({ invoiceId: salesReturns.invoiceId, totalAmount: salesReturns.totalAmount, completedAt: salesReturns.completedAt, voidedAt: salesReturns.voidedAt })
      .from(salesReturns).where(and(inArray(salesReturns.invoiceId, ids), sql`${salesReturns.completedAt} is not null`));
    for (const r of returnRows) {
      bucket(bookerOf.get(r.invoiceId)!).returns.push({ invoiceId: r.invoiceId, totalAmount: Number(r.totalAmount), completedAt: r.completedAt!, voidedAt: r.voidedAt });
    }
    const paymentRows = await tx.select({ invoiceId: payments.invoiceId, amount: payments.amount, method: payments.method, status: payments.status, effectiveDate: payments.effectiveDate, resolvedAt: payments.resolvedAt })
      .from(payments).where(and(inArray(payments.invoiceId, ids), inArray(payments.status, ["confirmed", "reversed"])));
    for (const p of paymentRows) {
      bucket(bookerOf.get(p.invoiceId)!).payments.push({
        invoiceId: p.invoiceId, amount: Number(p.amount), method: p.method, status: p.status,
        effectiveDate: p.effectiveDate, reversedAt: p.status === "reversed" ? p.resolvedAt : null,
      });
    }
  }
  const entryRows = await tx.select({ orderBookerId: commissionEarnings.orderBookerId, amount: commissionEarnings.amount, entryDate: commissionEarnings.entryDate })
    .from(commissionEarnings)
    .where(and(
      input.orderBookerIds === "all" ? undefined : inArray(commissionEarnings.orderBookerId, input.orderBookerIds),
      gte(commissionEarnings.entryDate, input.monthStart), lte(commissionEarnings.entryDate, input.monthEnd),
    ));
  for (const e of entryRows) bucket(e.orderBookerId).entries.push({ amount: Number(e.amount), entryDate: e.entryDate });
  return map;
}
