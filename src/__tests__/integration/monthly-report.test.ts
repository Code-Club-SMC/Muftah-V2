import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { customers, db, invoiceItems, invoices, payments, user, wallets, warehouses } from "@/db";
import { salesReturns } from "@/db/schemas/sales-erp-schema";
import { computeReturnCreditSplit } from "@/lib/sales/returns/return-lifecycle";
import { issueCustomerCreditFromReturn, issueCustomerRefund } from "@/server-functions/sales/customer-credit-service";
import { confirmPendingPayment, createInitialPayments, recalculateInvoiceSettlement, reverseConfirmedPayment } from "@/server-functions/sales/settlement-service";
import { loadMonthlyReport, loadMonthlyReportDetail } from "@/server-functions/reports/monthly-report-queries.server";
import type { MonthlyReportLine } from "@/lib/reports/monthly-report";
import { purchaseRecords } from "@/db";
import { supplierReturns } from "@/db/schemas/supplier-schema";
import { completeSupplierReturn, dispatchSupplierReturn, requestSupplierReturn } from "@/lib/suppliers/supplier-returns.server";
import { supplierReturnFixture } from "./supplier-return-fixture";
import { withRollback } from "./with-rollback";

// The supplier-return fixture records purchases through the add-stock server function.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown };
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data: unknown; context: unknown }) =>
      handler({ ...input, data: validator.parse(input.data) }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A year no other suite touches, so the totals below are exactly what this file seeded.
const YEAR = 2090;
const OCT = 3;
const at = (day: string) => new Date(`${day}T12:00:00+05:00`);

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Report actor", email: `${id}@test.invalid` }).returning();
  const [warehouse] = await tx.insert(warehouses).values({ name: id, address: "T", city: "T", state: "T", latitude: "0", longitude: "0" }).returning();
  const [customer] = await tx.insert(customers).values({ name: `Bilal ${id}` }).returning();
  const [cash, bank] = await tx.insert(wallets).values([
    { id: `${id}-c`, name: `${id}-cash`, type: "cash", balance: "1000000" },
    { id: `${id}-b`, name: `${id}-bank`, type: "bank", balance: "0" },
  ]).returning();
  return { actor, warehouse, customer, cash, bank };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

async function invoice(tx: Tx, s: Seeded, total: number, day = "2090-10-10", date = at(day)) {
  const [row] = await tx.insert(invoices).values({
    customerId: s.customer.id, invoiceNumber: randomUUID(), amount: total.toFixed(2), totalPrice: total.toFixed(2),
    outstandingAmount: total.toFixed(2), warehouseId: s.warehouse.id, performedById: s.actor.id,
    date, paymentDueDate: at("2091-01-01"),
  }).returning();
  return row;
}

const pay = (tx: Tx, s: Seeded, invoiceId: string, payment: Record<string, unknown>) =>
  createInitialPayments(tx, { invoiceId, actorId: s.actor.id, source: "invoice_creation", payments: [{ paymentDate: at("2090-10-10"), ...payment } as never] });

// The money steps of receiving a return, as the returns screen does them.
async function receiveReturn(tx: Tx, s: Seeded, invoiceId: string, total: number) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  const open = Math.max(0, Number(inv.totalPrice) - Number(inv.returnedAmount) - Number(inv.paidAmount) + Number(inv.excessCreditedAmount));
  const split = computeReturnCreditSplit(total, open);
  const note = `CN-${randomUUID()}`;
  const [ret] = await tx.insert(salesReturns).values({
    invoiceId, customerId: s.customer.id, reason: "test", status: "completed", completedAt: at("2090-10-12"),
    totalAmount: total.toFixed(2), creditNoteNumber: note, appliedToInvoiceAmount: split.appliedToInvoiceAmount.toFixed(2),
    customerCreditAmount: split.customerCreditAmount.toFixed(2),
  }).returning();
  if (split.customerCreditAmount > 0) await issueCustomerCreditFromReturn(tx, {
    customerId: s.customer.id, salesReturnId: ret.id, sourceInvoiceId: invoiceId, creditNoteNumber: note, amount: split.customerCreditAmount, performedById: s.actor.id,
  });
  await recalculateInvoiceSettlement(tx, invoiceId, { actorId: s.actor.id, reason: "return" });
  return ret;
}

async function report(tx: Tx) {
  const spy = vi.spyOn(db, "select").mockImplementation(((...args: []) => tx.select(...args)) as typeof db.select);
  try {
    const result = await loadMonthlyReport(YEAR, "2090-11-17");
    const lines = [...result.sale, ...result.consumption, ...result.result, ...result.purchases, result.weight];
    const value = (key: string, month = OCT) => (lines.find((line) => line.key === key) as MonthlyReportLine).months[month];
    const detail = async (key: string, month = "2090-10") => (await loadMonthlyReportDetail(key, month)).total;
    return { value, cash: await detail("cash"), credit: await detail("credit"), weight: await detail("weightTon"), lines };
  } finally {
    spy.mockRestore();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("monthly report against PostgreSQL", () => {
  it("does not count returned goods, nor the store credit spent later", () => withRollback(async (tx) => {
    const s = await seed(tx);
    const first = await invoice(tx, s, 10_000);
    await pay(tx, s, first.id, { method: "cash", amount: 10_000, walletId: s.cash.id });
    await receiveReturn(tx, s, first.id, 2_000);
    const second = await invoice(tx, s, 5_000);
    await pay(tx, s, second.id, { method: "customer_credit", amount: 2_000 });
    const r = await report(tx);
    // 10,000 - 2,000 returned + 5,000 = 13,000 sold, of which 3,000 is unpaid.
    expect({ total: r.value("totalSale"), cash: r.value("cash"), credit: r.value("credit") }).toEqual({ total: 13_000, cash: 10_000, credit: 3_000 });
    expect({ cash: r.cash, credit: r.credit }).toEqual({ cash: 10_000, credit: 3_000 });
  }));

  it("drops a return that was refunded in cash", () => withRollback(async (tx) => {
    const s = await seed(tx);
    const inv = await invoice(tx, s, 10_000);
    await pay(tx, s, inv.id, { method: "cash", amount: 10_000, walletId: s.cash.id });
    const ret = await receiveReturn(tx, s, inv.id, 2_000);
    await issueCustomerRefund(tx, { customerId: s.customer.id, amount: 2_000, walletId: s.cash.id, refundDate: at("2090-10-13"), salesReturnId: ret.id, performedById: s.actor.id, permissions: [] });
    const r = await report(tx);
    expect(r.value("totalSale")).toBe(8_000);
    expect(r.value("cash")).toBe(8_000);
  }));

  it("does not count money paid above the invoice after a return", () => withRollback(async (tx) => {
    const s = await seed(tx);
    const inv = await invoice(tx, s, 10_000);
    await pay(tx, s, inv.id, { method: "cheque", amount: 10_000, walletId: s.bank.id, chequeNumber: "1", chequeBank: "HBL", chequeDate: at("2090-10-10") });
    await receiveReturn(tx, s, inv.id, 4_000);
    const [cheque] = await tx.select().from(payments).where(eq(payments.invoiceId, inv.id));
    await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: s.actor.id, effectiveDate: at("2090-10-15") });
    const r = await report(tx);
    expect(r.value("totalSale")).toBe(6_000);
    expect(r.value("cash")).toBe(6_000);
  }));

  it("stays right when a payment is reversed after a return", () => withRollback(async (tx) => {
    const s = await seed(tx);
    const inv = await invoice(tx, s, 10_000);
    await pay(tx, s, inv.id, { method: "cash", amount: 10_000, walletId: s.cash.id });
    await receiveReturn(tx, s, inv.id, 2_000);
    const [payment] = await tx.select().from(payments).where(eq(payments.invoiceId, inv.id));
    await reverseConfirmedPayment(tx, { paymentId: payment.id, actorId: s.actor.id, effectiveDate: at("2090-10-16"), reason: "bounced" });
    const r = await report(tx);
    expect({ cash: r.value("cash"), credit: r.value("credit"), total: r.value("totalSale") }).toEqual({ cash: 0, credit: 8_000, total: 8_000 });
  }));

  it("keeps an invoice saved at 11:30pm Pakistan time in its own month", () => withRollback(async (tx) => {
    const s = await seed(tx);
    await invoice(tx, s, 700, "", new Date("2090-10-31T23:30:00+05:00"));
    await invoice(tx, s, 900, "", new Date("2090-11-01T00:30:00+05:00"));
    const r = await report(tx);
    expect(r.value("credit", OCT)).toBe(700);
    expect(r.value("credit", OCT + 1)).toBe(900);
  }));

  it("counts litre packs in the weight", () => withRollback(async (tx) => {
    const s = await seed(tx);
    const inv = await invoice(tx, s, 1_000);
    const item = { invoiceId: inv.id, pack: "x", hsnCode: "1", dispatchedUnits: 10 };
    await tx.insert(invoiceItems).values([
      // What invoices saved for 5 litre packs before the weight fix.
      { ...item, totalWeight: "0", fillAmountSnapshot: "5", fillUnitSnapshot: "L" },
      { ...item, totalWeight: "5", fillAmountSnapshot: "500", fillUnitSnapshot: "g" },
    ]);
    const r = await report(tx);
    expect(r.value("weightTon")).toBe(0.055);
    expect(r.weight).toBe(55);
  }));

  it("takes completed debit notes off the month's raw material bought", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet bags" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    const { debitNoteNumber } = await completeSupplierReturn(tx, { returnId: created.id }, actor.id);
    // Move both into this suite's year: bought 5 Oct, supplier accepted the goods back on 12 Oct.
    await tx.update(purchaseRecords).set({ purchaseDate: at("2090-10-05") }).where(eq(purchaseRecords.id, purchase.id));
    await tx.update(supplierReturns).set({ completedAt: at("2090-10-12") }).where(eq(supplierReturns.id, created.id));

    const r = await report(tx);
    expect(r.value("purchaseRawMaterial")).toBe(45_000);

    const spy = vi.spyOn(db, "select").mockImplementation(((...args: []) => tx.select(...args)) as typeof db.select);
    try {
      const detail = await loadMonthlyReportDetail("purchaseRawMaterial", "2090-10");
      expect(detail.total).toBe(45_000);
      const note = detail.rows.find((row) => row.reference === debitNoteNumber);
      expect(note).toMatchObject({ amount: -5000, date: "2090-10-12" });
      expect(note?.description).toMatch(/^Returned 10 kg .*Soda Ash to .*Ali Traders$/);
    } finally {
      spy.mockRestore();
    }
  }));

  it("leaves voided debit notes out", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet bags" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    await completeSupplierReturn(tx, { returnId: created.id }, actor.id);
    await tx.update(purchaseRecords).set({ purchaseDate: at("2090-10-05") }).where(eq(purchaseRecords.id, purchase.id));
    await tx.update(supplierReturns).set({ status: "voided", voidedAt: at("2090-10-13"), completedAt: at("2090-10-12") }).where(eq(supplierReturns.id, created.id));

    const r = await report(tx);
    expect(r.value("purchaseRawMaterial")).toBe(50_000);
  }));
});
