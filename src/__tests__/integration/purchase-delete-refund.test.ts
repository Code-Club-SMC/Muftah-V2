import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, chemicals, expenses, materialLotStock, materialLotMovements, purchaseRecords, supplierPayments, suppliers, transactions, warehouses } from "@/db";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";
import { expenseFixture } from "./expense-fixture";
import { takeLotPicks } from "@/lib/inventory/material-lots.server";
import { PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { addPaymentFn } from "@/server-functions/suppliers/add-payment-fn";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown };
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => async (input: { data: unknown; context: unknown }) =>
      handler({ ...input, data: validator.parse(input.data) }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {}, requireSuppliersManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function fixture() {
  const f = await expenseFixture("20000.00"); // cash 20,000, bank 50,000
  const [floor] = await db.insert(warehouses).values({ ...warehouseValues, name: f.id }).returning();
  const [supplier] = await db.insert(suppliers).values({ supplierName: `${f.id}-supplier` }).returning();
  const [soda] = await db.insert(chemicals).values({ name: `${f.id} Soda Ash`, unit: "kg", costPerUnit: "70" }).returning();
  // Like Buy Again: the wallet is chosen in "paymentMethod", and no wallet is saved on the payment row.
  const buy = async (cost: string, quantity: string, payFrom: string, status: "paid" | "unpaid" = "paid") => {
    await addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: payFrom, walletId: "", paymentStatus: status, amountPaid: "", transactionId: "", bankName: "" }, context: f.context } as never);
    const rows = await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
  };
  const remove = (id: string, extra: Record<string, string> = {}) => deletePurchaseRecordFn({ data: { id, reason: "Duplicate supplier entry", ...extra }, context: f.context } as never);
  const state = (id: string) => getPurchaseEditStateFn({ data: { id }, context: f.context } as never) as Promise<{ stockLocked: boolean; refund: { paid: string; walletId: string | null } }>;
  const walletExpenses = (walletId: string) => db.select().from(expenses).where(eq(expenses.walletId, walletId));
  const refunds = (walletId: string) => db.select().from(transactions).where(eq(transactions.walletId, walletId)).then((rows) => rows.filter((t) => t.source === "Supplier Refund"));
  const record = async (id: string) => (await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, id)))[0];
  const payments = (id: string) => db.select().from(supplierPayments).where(eq(supplierPayments.purchaseId, id));
  const stock = async (lotId: string) => (await db.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, lotId), eq(materialLotStock.warehouseId, floor.id))))[0].quantity;
  return { ...f, floor, supplier, soda, buy, remove, state, walletExpenses, refunds, record, payments, stock };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("voiding retains purchases and payments", () => {
  it("returns everything to the wallet that paid, by default", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);
    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");

    expect((await f.state(purchase.id)).refund).toEqual({ paid: "7000.00", walletId: f.cash.id });

    await f.remove(purchase.id);

    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
    expect(await f.refunds(f.cash.id)).toMatchObject([{ type: "credit", amount: "7000.00", referenceId: purchase.id }]);
    // The original expense stays visible but voided, so reports no longer count it.
    const rows = await f.walletExpenses(f.cash.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].voidedAt).not.toBeNull();
    const retained = await f.record(purchase.id);
    expect(retained).toMatchObject({ cost: "7000.00", quantity: "100.000", paidAmount: "7000.00",
      voidReason: "Duplicate supplier entry", voidRefundAmount: "7000.00", voidRefundWalletId: f.cash.id,
      voidedById: f.actor.id, voidSnapshot: { materialName: f.soda.name, unit: "kg", supplierName: f.supplier.supplierName } });
    expect(retained.voidedAt).not.toBeNull();
    expect(await f.payments(purchase.id)).toMatchObject([{ amount: "7000.00" }]);
    expect(await f.stock(purchase.lotId!)).toBe("0.000");
    await expect(f.remove(purchase.id)).rejects.toThrow("Purchase is already voided");
    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
    expect(await f.refunds(f.cash.id)).toHaveLength(1);
  });

  it("refunds a smaller amount to another wallet and keeps the rest as an expense", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);

    await f.remove(purchase.id, { refundWalletId: f.bank.id, refundAmount: "6500" });

    expect(await f.balanceOf(f.bank.id)).toBe("56500.00");
    expect(await f.balanceOf(f.cash.id)).toBe("13000.00"); // cash paid it and gets nothing back
    expect(await f.refunds(f.bank.id)).toMatchObject([{ amount: "6500.00" }]);
    const rows = (await f.walletExpenses(f.cash.id)).sort((a, b) => Number(a.amount) - Number(b.amount) * -1);
    const live = rows.filter((row) => !row.voidedAt);
    expect(rows.filter((row) => row.voidedAt)).toHaveLength(1);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ amount: "500.00", category: "Supplier Purchase" });
    expect(await f.record(purchase.id)).toMatchObject({ paidAmount: "7000.00", voidRefundAmount: "6500.00", voidRefundWalletId: f.bank.id });
    expect(await f.payments(purchase.id)).toMatchObject([{ amount: "7000.00" }]);
  });

  it("allows no refund at all, keeping the whole amount as an expense", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);

    await f.remove(purchase.id, { refundWalletId: f.cash.id, refundAmount: "0" });

    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");
    expect(await f.refunds(f.cash.id)).toHaveLength(0);
    expect((await f.walletExpenses(f.cash.id)).filter((row) => !row.voidedAt)).toMatchObject([{ amount: "7000.00" }]);
    expect(await f.record(purchase.id)).toMatchObject({ paidAmount: "7000.00", voidRefundAmount: "0.00", voidRefundWalletId: null });
    expect(await f.payments(purchase.id)).toMatchObject([{ amount: "7000.00" }]);
  });

  it("refunds payments recorded with a wallet id too, and ignores unpaid purchases", async () => {
    const f = await fixture();
    const unpaid = await f.buy("3500", "50", "pay_later", "unpaid");
    expect((await f.state(unpaid.id)).refund).toEqual({ paid: "0.00", walletId: null });

    await f.remove(unpaid.id);

    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
    expect(await f.refunds(f.cash.id)).toHaveLength(0);
    expect(await f.walletExpenses(f.cash.id)).toHaveLength(0);
  });

  it("refuses more than was paid, an unknown wallet or a bad amount, and changes nothing", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);

    await expect(f.remove(purchase.id, { refundAmount: "7000.01" })).rejects.toThrow("Refund cannot be more than what was paid");
    await expect(f.remove(purchase.id, { refundWalletId: "no-such-wallet", refundAmount: "100" })).rejects.toThrow("Pick the wallet to refund to");
    await expect(f.remove(purchase.id, { refundAmount: "abc" })).rejects.toThrow("Refund amount must be a number");

    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");
    expect(await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchase.id))).toHaveLength(1);
    expect((await f.record(purchase.id)).voidedAt).toBeNull();
    expect(await f.stock(purchase.lotId!)).toBe("100.000");
    expect(await f.payments(purchase.id)).toMatchObject([{ amount: "7000.00" }]);
    expect((await f.walletExpenses(f.cash.id))[0].voidedAt).toBeNull();
    expect(await f.refunds(f.cash.id)).toHaveLength(0);
  });

  it("rejects blank and overlong reasons before any reversal", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);
    await expect(f.remove(purchase.id, { reason: "   " })).rejects.toThrow();
    await expect(f.remove(purchase.id, { reason: "x".repeat(1001) })).rejects.toThrow();
    expect((await f.record(purchase.id)).voidedAt).toBeNull();
    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");
    expect(await f.stock(purchase.lotId!)).toBe("100.000");
  });

  it("does not reverse used stock or its payment", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);
    await db.transaction(tx => takeLotPicks(tx, { warehouseId: f.floor.id,
      ref: { materialType: "chemical", materialId: f.soda.id }, name: f.soda.name, unit: "kg", required: "1",
      picks: [{ lotId: purchase.lotId!, quantity: "1" }], sourceType: "mixing" }));
    await expect(f.remove(purchase.id)).rejects.toThrow(PURCHASE_LOCKED_MESSAGE);
    expect((await f.record(purchase.id)).voidedAt).toBeNull();
    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");
    expect(await f.stock(purchase.lotId!)).toBe("99.000");
    expect(await f.refunds(f.cash.id)).toHaveLength(0);
  });

  it("serializes concurrent voids so stock and money reverse exactly once", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);
    const results = await Promise.allSettled([f.remove(purchase.id), f.remove(purchase.id)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("Purchase is already voided");
    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
    expect(await f.refunds(f.cash.id)).toHaveLength(1);
    expect(await f.stock(purchase.lotId!)).toBe("0.000");
    const movements = await db.select().from(materialLotMovements).where(and(eq(materialLotMovements.sourceId, purchase.id), eq(materialLotMovements.sourceType, "purchase_delete")));
    expect(movements).toHaveLength(1);
    expect(await f.payments(purchase.id)).toHaveLength(1);
  });

  it("rejects editing, edit-state and payments for a voided purchase", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);
    await f.remove(purchase.id);
    await expect(updatePurchaseRecordFn({ data: { id: purchase.id, cost: "8000" }, context: f.context } as never)).rejects.toThrow("voided");
    await expect(f.state(purchase.id)).rejects.toThrow("voided");
    await expect(addPaymentFn({ data: { supplierId: f.supplier.id, purchaseId: purchase.id, amount: "1", walletId: f.cash.id }, context: f.context } as never)).rejects.toThrow("voided");
    expect(await f.payments(purchase.id)).toHaveLength(1);
    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
  });

  it("checks supplier ownership before posting a purchase payment", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", "pay_later", "unpaid");
    const [other] = await db.insert(suppliers).values({ supplierName: `${f.id}-other` }).returning();
    await expect(addPaymentFn({ data: { supplierId: other.id, purchaseId: purchase.id, amount: "1", walletId: f.cash.id }, context: f.context } as never)).rejects.toThrow("supplier");
    expect(await f.payments(purchase.id)).toHaveLength(0);
    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
  });

  it("serializes payments against voiding on the same purchase", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", "pay_later", "unpaid");
    const [payment, voided] = await Promise.allSettled([
      addPaymentFn({ data: { supplierId: f.supplier.id, purchaseId: purchase.id, amount: "7000", walletId: f.cash.id }, context: f.context } as never),
      f.remove(purchase.id),
    ]);
    expect(voided.status).toBe("fulfilled");
    if (payment.status === "rejected") expect(payment.reason.message).toContain("voided");
    const paidFirst = payment.status === "fulfilled";
    expect(await f.payments(purchase.id)).toHaveLength(paidFirst ? 1 : 0);
    expect(await f.record(purchase.id)).toMatchObject({ voidRefundAmount: paidFirst ? "7000.00" : "0.00" });
    expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
    expect(await f.refunds(f.cash.id)).toHaveLength(paidFirst ? 1 : 0);
    expect(await f.stock(purchase.lotId!)).toBe("0.000");
  });

  it("does not allow concurrent payments to exceed the remaining balance", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", "pay_later", "unpaid");
    const pay = () => addPaymentFn({ data: { supplierId: f.supplier.id, purchaseId: purchase.id, amount: "7000", walletId: f.cash.id }, context: f.context } as never);
    const results = await Promise.allSettled([pay(), pay()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await f.payments(purchase.id)).toHaveLength(1);
    expect((await f.record(purchase.id)).paidAmount).toBe("7000.00");
    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");
  });

  it("enforces complete void metadata and refund bounds in PostgreSQL", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);
    await expect(db.update(purchaseRecords).set({ voidedAt: new Date() }).where(eq(purchaseRecords.id, purchase.id))).rejects.toThrow();
    await f.remove(purchase.id);
    await expect(db.update(purchaseRecords).set({ voidRefundAmount: "7000.01" }).where(eq(purchaseRecords.id, purchase.id))).rejects.toThrow();
    await expect(db.update(purchaseRecords).set({ voidRefundAmount: "-1" }).where(eq(purchaseRecords.id, purchase.id))).rejects.toThrow();
    expect((await f.record(purchase.id)).voidRefundAmount).toBe("7000.00");
  });
});
