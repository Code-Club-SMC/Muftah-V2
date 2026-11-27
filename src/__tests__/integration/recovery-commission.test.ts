import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, user, warehouses, products, packagingMaterials, recipes, customers, invoiceItems, invoices, wallets, payments } from "@/db";
import { formulas, mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { commissionEarnings, commissionRecords, commissionTiers, orderBookers, orders, salesReturnReasons, salesReturns } from "@/db/schemas/sales-erp-schema";
import { createInvoiceFn } from "@/server-functions/sales/invoices-fn";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { addPaymentsToInvoice, confirmPendingPayment, reverseConfirmedPayment } from "@/server-functions/sales/settlement-service";
import { completeSalesReturnFn, createSalesReturnFn, decideSalesReturnFn, voidSalesReturnFn } from "@/server-functions/sales/sales-returns-fn";
import { resolveOrderCommissionTerms } from "@/server-functions/sales/recovery-commission-service";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | ((data: unknown) => unknown);
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data: unknown; context: unknown }) =>
      handler({ ...input, data: typeof validator === "function" ? validator(input.data) : validator.parse(input.data) }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireSalesViewMiddleware: {}, requireSalesManageMiddleware: {}, requireInventoryManageMiddleware: {}, requireInventoryViewMiddleware: {}, requireSalesReturnsCreateMiddleware: {}, requireSalesReturnsApproveMiddleware: {}, requireReturnsReceiveMiddleware: {}, requireReturnsDisposeMiddleware: {}, requireReportsViewMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => ({}) }));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("rollback commission fixture");

async function invoke(fn: unknown, data: unknown, actorId: string): Promise<any> {
  const session = { user: { id: actorId, name: "Commission test" } };
  return (fn as Function)({ data, context: { session, authContext: { session, permissions: new Set(["*"]) } } });
}

async function seed(tx: Tx, bookerRate = "2") {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: id, email: `${id}@test.invalid` }).returning();
  const warehouse = (await tx.select().from(warehouses).where(and(eq(warehouses.type, "factory_floor"), eq(warehouses.isActive, true))).limit(1))[0] ??
    (await tx.insert(warehouses).values({ name: id, address: "T", city: "T", state: "T", latitude: "0", longitude: "0", type: "factory_floor" }).returning())[0];
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [pack] = await tx.insert(packagingMaterials).values({ name: `${id}-pack`, costPerUnit: "1" }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "20", batchUnit: "kg" }).returning();
  const [recipe] = await tx.insert(recipes).values({ productId: product.id, formulaId: formula.id, name: id, batchSize: "20", batchUnit: "kg", containerType: "pack", containerPackagingId: pack.id, containersPerCarton: 0, fillAmount: "1000", fillUnit: "g" }).returning();
  const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "20000", bulkUnit: "kg", status: "completed" }).returning();
  const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: recipe.id, warehouseId: warehouse.id, operatorId: actor.id,
    allocatedBulkQuantity: "20000", allocatedBulkUnit: "kg", allocatedChemicalCost: "20000", targetContainers: 20000, completedContainers: 20000, status: "in_progress" }).returning();
  await completePackagingAllocationCore(tx, allocation.id, actor.id);
  const [customer] = await tx.insert(customers).values({ name: id, customerType: "retailer" }).returning();
  const [booker] = await tx.insert(orderBookers).values({ name: `Booker ${id.slice(0, 6)}`, commissionRate: bookerRate }).returning();
  const [cash] = await tx.insert(wallets).values({ id: randomUUID(), name: `cash-${id}`, type: "cash" }).returning();
  const [bank] = await tx.insert(wallets).values({ id: randomUUID(), name: `bank-${id}`, type: "bank" }).returning();
  const [reason] = await tx.insert(salesReturnReasons).values({ name: id }).returning();
  return { actor, warehouse, recipe, customer, booker, cash, bank, reason };
}
type Fixture = Awaited<ReturnType<typeof seed>>;

async function withFixture(check: (tx: Tx, f: Fixture) => Promise<void>, bookerRate = "2") {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Isolated TEST_DATABASE_URL required");
  try {
    await db.transaction(async (tx) => {
      const f = await seed(tx, bookerRate);
      const spy = vi.spyOn(db, "transaction").mockImplementation(((cb: Parameters<typeof db.transaction>[0]) => tx.transaction(cb)) as typeof db.transaction);
      try { await check(tx, f); } finally { spy.mockRestore(); }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

let billNumber = 1;
/** Books an order and converts it into an invoice of `units` packs at Rs 100 each (invoice total = units × 100). */
async function deliverOrder(tx: Tx, f: Fixture, units: number) {
  const [order] = await tx.insert(orders).values({ billNumber: billNumber++, orderBookerId: f.booker.id, shopkeeperName: "Shop" }).returning();
  const invoice = await invoke(createInvoiceFn, {
    customerId: f.customer.id, warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"), orderId: order.id,
    items: [{ recipeId: f.recipe.id, pack: f.recipe.name, unitType: "units", numberOfUnits: units, numberOfCartons: 0, perCartonPrice: 100, retailPrice: 100 }],
  }, f.actor.id);
  return { order, invoice };
}

async function pay(tx: Tx, f: Fixture, invoiceId: string, amount: number, method: "cash" | "cheque" = "cash", paymentDate = new Date()) {
  const [payment] = await addPaymentsToInvoice(tx, { invoiceId, actorId: f.actor.id, payments: [
    method === "cash"
      ? { method: "cash", walletId: f.cash.id, amount, paymentDate }
      : { method: "cheque", walletId: f.bank.id, amount, paymentDate, chequeNumber: `CHQ-${randomUUID().slice(0, 6)}`, chequeBank: "HBL", chequeDate: paymentDate },
  ] });
  return payment;
}

const ledger = (tx: Tx, invoiceId: string) =>
  tx.select().from(commissionEarnings).where(eq(commissionEarnings.invoiceId, invoiceId)).orderBy(commissionEarnings.createdAt);

describe.skipIf(!process.env.TEST_DATABASE_URL)("recovery-based commission", () => {
  it("locks the booker's effective rate at delivery and earns nothing on delivery", async () => {
    await withFixture(async (tx, f) => {
      const { order, invoice } = await deliverOrder(tx, f, 10);
      const saved = (await tx.query.orders.findFirst({ where: eq(orders.id, order.id) }))!;
      expect([saved.commissionMode, saved.commissionRateLocked]).toEqual(["recovery", "2.0000"]);
      expect(await ledger(tx, invoice.id)).toEqual([]);
      expect(await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, order.id))).toEqual([]);
    });
  });

  it("locks the blended slab rate, so a fully paid order earns what the slabs give", async () => {
    await withFixture(async (tx, f) => {
      await tx.insert(commissionTiers).values([
        { orderBookerId: f.booker.id, minAmount: "0", maxAmount: "500", rate: "1" },
        { orderBookerId: f.booker.id, minAmount: "500", maxAmount: null, rate: "3" },
      ]);
      const { order } = await deliverOrder(tx, f, 10); // Rs 1,000: 500×1% + 500×3% = Rs 20, i.e. 2%
      expect((await tx.query.orders.findFirst({ where: eq(orders.id, order.id) }))!.commissionRateLocked).toBe("2.0000");
    });
  });

  it("moves old orders over: unpaid delivery commission is cancelled, paid stays and earns nothing more", async () => {
    await withFixture(async (tx, f) => {
      const make = async (status: string | null) => {
        const [order] = await tx.insert(orders).values({ billNumber: billNumber++, orderBookerId: f.booker.id, shopkeeperName: "Old", status: "delivered", fulfilledAmount: "100000.00" }).returning();
        if (status) await tx.insert(commissionRecords).values({ orderBookerId: f.booker.id, orderId: order.id, fulfilledAmount: "100000.00", appliedRate: "2.00", commissionAmount: "2000.00", status });
        return order;
      };
      const unpaid = await make("accrued");
      const paid = await make("paid");
      const none = await make(null);
      expect(await resolveOrderCommissionTerms(tx, unpaid.id)).toEqual({ mode: "recovery", rate: 2 });
      expect(await resolveOrderCommissionTerms(tx, paid.id)).toEqual({ mode: "delivery_paid", rate: 2 });
      expect(await resolveOrderCommissionTerms(tx, none.id)).toEqual({ mode: "suppressed", rate: 0 });
      const [record] = await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, unpaid.id));
      expect(record.status).toBe("cancelled");
      // Running it again changes nothing.
      expect(await resolveOrderCommissionTerms(tx, unpaid.id)).toEqual({ mode: "recovery", rate: 2 });
    });
  });

  it("keeps the locked rate when the booker's rate changes later", async () => {
    await withFixture(async (tx, f) => {
      const { order } = await deliverOrder(tx, f, 10);
      await tx.update(orderBookers).set({ commissionRate: "5" }).where(eq(orderBookers.id, f.booker.id));
      expect(await resolveOrderCommissionTerms(tx, order.id)).toEqual({ mode: "recovery", rate: 2 });
    });
  });

  it("earns on a full payment, dated on the payment day (behaviour 1)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000); // Rs 1,00,000
      const paidOn = new Date("2026-10-20T10:00:00+05:00");
      const payment = await pay(tx, f, invoice.id, 100000, "cash", paidOn);
      const rows = await ledger(tx, invoice.id);
      expect(rows.map((r) => [r.kind, r.paymentId, r.baseAmount, r.rate, r.amount, r.entryDate.toISOString()])).toEqual([
        ["payment", payment.id, "100000.00", "2.0000", "2000.00", paidOn.toISOString()],
      ]);
      expect(rows[0].orderBookerId).toBe(f.booker.id);
    });
  });

  it("splits partial payments by month (behaviour 2)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 5000); // Rs 5,00,000
      await pay(tx, f, invoice.id, 200000, "cash", new Date("2026-10-20T10:00:00+05:00"));
      await pay(tx, f, invoice.id, 200000, "cash", new Date("2026-11-15T10:00:00+05:00"));
      expect((await ledger(tx, invoice.id)).map((r) => [r.amount, r.entryDate.toISOString().slice(0, 7)])).toEqual([
        ["4000.00", "2026-10"], ["4000.00", "2026-11"],
      ]);
    });
  });

  it("earns on a cheque only when it clears, dated on the clear date (behaviour 5)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const cheque = await pay(tx, f, invoice.id, 50000, "cheque");
      expect(cheque.status).toBe("pending");
      expect(await ledger(tx, invoice.id)).toEqual([]);
      const cleared = new Date("2026-11-03T12:00:00+05:00");
      await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: cleared });
      const rows = await ledger(tx, invoice.id);
      expect(rows.map((r) => [r.amount, r.entryDate.toISOString()])).toEqual([["1000.00", cleared.toISOString()]]);
    });
  });

  it("earns nothing on a suppressed order or an old order already paid on delivery (behaviours 8, 11)", async () => {
    await withFixture(async (tx, f) => {
      const { order, invoice } = await deliverOrder(tx, f, 1000);
      await tx.update(orders).set({ commissionMode: "suppressed", commissionRateLocked: "0.0000" }).where(eq(orders.id, order.id));
      await pay(tx, f, invoice.id, 10000);
      const second = await deliverOrder(tx, f, 1000);
      await tx.update(orders).set({ commissionMode: "delivery_paid" }).where(eq(orders.id, second.order.id));
      await pay(tx, f, second.invoice.id, 10000);
      expect(await ledger(tx, invoice.id)).toEqual([]);
      expect(await ledger(tx, second.invoice.id)).toEqual([]);
    });
  });

  it("earns at the old order's rate after its unpaid delivery commission was cancelled (behaviour 9)", async () => {
    await withFixture(async (tx, f) => {
      const { order, invoice } = await deliverOrder(tx, f, 1000);
      // Make it look like a pre-phase-6 order: no locked terms, an unpaid 1.5% delivery record.
      await tx.update(orders).set({ commissionMode: null, commissionRateLocked: null }).where(eq(orders.id, order.id));
      await tx.insert(commissionRecords).values({ orderBookerId: f.booker.id, orderId: order.id, fulfilledAmount: "100000.00", appliedRate: "1.50", commissionAmount: "1500.00", status: "accrued" });
      await pay(tx, f, invoice.id, 40000);
      expect((await ledger(tx, invoice.id)).map((r) => [r.rate, r.amount])).toEqual([["1.5000", "600.00"]]);
      expect((await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, order.id)))[0].status).toBe("cancelled");
    });
  });

  it("writes one row per payment even if the earning step runs twice (behaviour 12)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const payment = await pay(tx, f, invoice.id, 10000);
      const { earnCommissionForPayment } = await import("@/server-functions/sales/recovery-commission-service");
      await earnCommissionForPayment(tx, payment, f.actor.id);
      expect(await ledger(tx, invoice.id)).toHaveLength(1);
    });
  });

  it("deducts from the booker on the reversal date by default (behaviour 6)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 5000);
      const cheque = await pay(tx, f, invoice.id, 200000, "cheque");
      await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: new Date("2026-10-10T10:00:00+05:00") });
      const bounced = new Date("2026-11-05T10:00:00+05:00");
      await reverseConfirmedPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: bounced, reason: "Cheque bounced" });
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.bearer, r.baseAmount, r.amount, r.entryDate.toISOString()])).toEqual([
        ["payment", null, "200000.00", "4000.00", "2026-10-10T05:00:00.000Z"],
        ["payment_reversal", "booker", "-200000.00", "-4000.00", bounced.toISOString()],
      ]);
    });
  });

  it("records the company bearing the loss without a deduction, and does not earn twice on the replacement payment", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const payment = await pay(tx, f, invoice.id, 100000);
      await reverseConfirmedPayment(tx, { paymentId: payment.id, actorId: f.actor.id, effectiveDate: new Date(), reason: "Wrong account", commissionBearer: "company" });
      await pay(tx, f, invoice.id, 100000);
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.bearer, r.amount, r.createdById])).toEqual([
        ["payment", null, "2000.00", f.actor.id],
        ["payment_reversal", "company", "0.00", f.actor.id],
      ]);
    });
  });

  it("tells the reversal dialog how much commission a payment earned", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const payment = await pay(tx, f, invoice.id, 100000);
      const { getPaymentCommission } = await import("@/server-functions/sales/recovery-commission-service");
      expect(await getPaymentCommission(tx, payment.id)).toEqual({ amount: 2000, orderBookerName: f.booker.name });
      await reverseConfirmedPayment(tx, { paymentId: payment.id, actorId: f.actor.id, effectiveDate: new Date(), reason: "Bounced" });
      expect(await getPaymentCommission(tx, payment.id)).toBeNull();
    });
  });

  async function returnPacks(tx: Tx, f: Fixture, invoiceId: string, packs: number) {
    const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    const created = await invoke(createSalesReturnFn, { invoiceId, reasonId: f.reason.id, items: [{ invoiceItemId: item.id, quantityReturned: packs, refundPerUnit: 100 }] }, f.actor.id);
    await invoke(decideSalesReturnFn, { returnId: created.id, action: "approve" }, f.actor.id);
    await invoke(completeSalesReturnFn, { returnId: created.id, lines: [{ returnItemId: created.items[0].id, goodUnits: packs }] }, f.actor.id);
    return created;
  }

  it("earns only on money paid when a return comes before the rest of the payment (behaviour 3)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 5000); // Rs 5,00,000
      await pay(tx, f, invoice.id, 200000);
      await returnPacks(tx, f, invoice.id, 1000); // Rs 1,00,000 back, still owed 2,00,000: nothing to take back
      await pay(tx, f, invoice.id, 200000);
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.amount])).toEqual([["payment", "4000.00"], ["payment", "4000.00"]]);
    });
  });

  it("takes back commission on money above what is owed after a return, and adds it back on void (decision 1)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000); // Rs 1,00,000
      await pay(tx, f, invoice.id, 100000); // +2,000
      const salesReturn = await returnPacks(tx, f, invoice.id, 300); // Rs 30,000 to store credit
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.salesReturnId, r.baseAmount, r.amount])).toEqual([
        ["payment", null, "100000.00", "2000.00"],
        ["return_clawback", salesReturn.id, "-30000.00", "-600.00"],
      ]);
      await invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Wrong invoice" }, f.actor.id);
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.amount])).toEqual([
        ["payment", "2000.00"], ["return_clawback", "-600.00"], ["return_clawback_undo", "600.00"],
      ]);
    });
  });

  it("caps earnings at the net invoice, so later money above it earns nothing (behaviour 4)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      await returnPacks(tx, f, invoice.id, 300); // owes 70,000
      await pay(tx, f, invoice.id, 70000);
      expect((await ledger(tx, invoice.id)).map((r) => r.baseAmount)).toEqual(["70000.00"]);
    });
  });

  it("pays a positive month, then carries a bounced cheque's deduction into later months (behaviour 6 carry-forward)", async () => {
    await withFixture(async (tx, f) => {
      const { collectPayslipCommission, markPayslipCommissionPaid } = await import("@/server-functions/sales/recovery-commission-service");
      const { invoice } = await deliverOrder(tx, f, 5000);
      const cheque = await pay(tx, f, invoice.id, 200000, "cheque");
      await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: new Date("2026-10-10T10:00:00+05:00") });
      const october = await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"));
      expect(october.settlement.payable).toBe(4000);
      await markPayslipCommissionPaid(tx, october.entryIds, "payslip-oct");

      await pay(tx, f, invoice.id, 50000, "cash", new Date("2026-11-20T10:00:00+05:00")); // +1,000
      await reverseConfirmedPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: new Date("2026-11-05T10:00:00+05:00"), reason: "Bounced" }); // -4,000
      const november = await collectPayslipCommission(tx, f.booker.id, new Date("2026-12-01T00:00:00+05:00"));
      expect([november.settlement.payable, november.settlement.carriedForward, november.settlement.paysEntries]).toEqual([0, 3000, false]);
      expect(november.breakdown).toMatchObject({ kind: "recovery", paymentsCount: 1, earned: 1000, deductions: 4000, carriedForward: 3000 });

      const second = await deliverOrder(tx, f, 5000);
      await pay(tx, f, second.invoice.id, 500000, "cash", new Date("2026-12-10T10:00:00+05:00")); // +10,000
      const december = await collectPayslipCommission(tx, f.booker.id, new Date("2027-01-01T00:00:00+05:00"));
      expect(december.settlement.payable).toBe(7000);
      expect(december.entryIds).toHaveLength(3);
    });
  });

  it("frees a deleted payslip's rows so the next payslip pays them again", async () => {
    await withFixture(async (tx, f) => {
      const { collectPayslipCommission, markPayslipCommissionPaid, releasePayslipCommission } = await import("@/server-functions/sales/recovery-commission-service");
      const { invoice } = await deliverOrder(tx, f, 1000);
      await pay(tx, f, invoice.id, 100000, "cash", new Date("2026-10-10T10:00:00+05:00"));
      const first = await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"));
      await markPayslipCommissionPaid(tx, first.entryIds, "payslip-x");
      expect((await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"))).entryIds).toEqual([]);
      await releasePayslipCommission(tx, "payslip-x");
      expect((await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"))).settlement.payable).toBe(2000);
    });
  });

  it("builds the month summary from real rows (spec example)", async () => {
    await withFixture(async (tx, f) => {
      const { loadBookerMonthInputs } = await import("@/server-functions/sales/recovery-commission-service");
      const { summarizeBookerMonth } = await import("@/lib/order-booker/recovery-commission");
      const { invoice } = await deliverOrder(tx, f, 5000); // Rs 5,00,000 today
      await pay(tx, f, invoice.id, 200000, "cash", new Date());
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const inputs = await loadBookerMonthInputs(tx, { orderBookerIds: [f.booker.id], monthStart, monthEnd });
      expect(summarizeBookerMonth(inputs.get(f.booker.id)!)).toEqual({
        delivered: 500000, returned: 0, collected: 200000, earned: 4000, stillOwed: 300000, waiting: 6000,
      });
    });
  });
});
