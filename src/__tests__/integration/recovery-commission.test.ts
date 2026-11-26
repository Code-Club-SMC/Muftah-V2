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
  const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "2000", bulkUnit: "kg", status: "completed" }).returning();
  const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: recipe.id, warehouseId: warehouse.id, operatorId: actor.id,
    allocatedBulkQuantity: "2000", allocatedBulkUnit: "kg", allocatedChemicalCost: "2000", targetContainers: 2000, completedContainers: 2000, status: "in_progress" }).returning();
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
});
