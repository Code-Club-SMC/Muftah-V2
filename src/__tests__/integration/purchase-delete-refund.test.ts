import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, chemicals, expenses, purchaseRecords, suppliers, transactions, warehouses } from "@/db";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";
import { expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
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
  const remove = (id: string, extra: Record<string, string> = {}) => deletePurchaseRecordFn({ data: { id, ...extra }, context: f.context } as never);
  const state = (id: string) => getPurchaseEditStateFn({ data: { id }, context: f.context } as never) as Promise<{ stockLocked: boolean; refund: { paid: string; walletId: string | null } }>;
  const walletExpenses = (walletId: string) => db.select().from(expenses).where(eq(expenses.walletId, walletId));
  const refunds = (walletId: string) => db.select().from(transactions).where(eq(transactions.walletId, walletId)).then((rows) => rows.filter((t) => t.source === "Supplier Refund"));
  return { ...f, floor, supplier, soda, buy, remove, state, walletExpenses, refunds };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("deleting a purchase gives the money back", () => {
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
    expect(await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchase.id))).toHaveLength(0);
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
  });

  it("allows no refund at all, keeping the whole amount as an expense", async () => {
    const f = await fixture();
    const purchase = await f.buy("7000", "100", f.cash.id);

    await f.remove(purchase.id, { refundWalletId: f.cash.id, refundAmount: "0" });

    expect(await f.balanceOf(f.cash.id)).toBe("13000.00");
    expect(await f.refunds(f.cash.id)).toHaveLength(0);
    expect((await f.walletExpenses(f.cash.id)).filter((row) => !row.voidedAt)).toMatchObject([{ amount: "7000.00" }]);
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
  });
});
