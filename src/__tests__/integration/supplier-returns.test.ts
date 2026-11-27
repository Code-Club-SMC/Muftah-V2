import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { purchaseRecords, supplierPayments, wallets } from "@/db";
import { supplierCreditMovements, supplierReturns } from "@/db/schemas/supplier-schema";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { applySupplierCredit, assertPurchaseHasNoActiveReturn, cancelSupplierReturn, completeSupplierReturn, dispatchSupplierReturn, listSupplierReturns, previewDebitNote, requestSupplierReturn, restoreCreditUsedOnPurchase, returnableForPurchase, supplierCreditBalance, voidSupplierReturn } from "@/lib/suppliers/supplier-returns.server";
import { supplierReturnFixture } from "./supplier-return-fixture";
import { withRollback } from "./with-rollback";

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

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: request", () => {
  it("offers what is left of the purchase in its store and values the request at the purchase price", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const returnable = await returnableForPurchase(tx, purchase.id);
    expect(returnable).toMatchObject({ max: "100.000", unitCost: "500.00", blockedReason: null });

    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Lumpy, wet bags" }, actor.id);
    expect(created.returnNumber).toMatch(/^SR-\d{4,}$/);
    expect(created.totalAmount).toBe("5000.00");
    expect((await returnableForPurchase(tx, purchase.id)).max).toBe("90.000");
  }));

  it("refuses more than is returnable, zero, and voided or legacy purchases", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    await expect(requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "100.001", reason: "x" }, actor.id))
      .rejects.toThrow("Only 100 kg of this purchase can be returned");
    await expect(requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "0", reason: "x" }, actor.id)).rejects.toThrow();
    await tx.update(purchaseRecords).set({ lotId: null }).where(eq(purchaseRecords.id, purchase.id));
    expect((await returnableForPurchase(tx, purchase.id)).blockedReason).toContain("before price lots");
  }));

  it("cancels a request without moving stock", () => withRollback(async (tx) => {
    const { actor, buy, stock } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    const result = await cancelSupplierReturn(tx, { returnId: created.id, reason: "Supplier took it back as replacement" }, actor.id);
    expect(result.stockRestored).toBe(false);
    expect(await stock()).toBe("100.000");
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, created.id));
    expect(row.status).toBe("cancelled");
    expect((await returnableForPurchase(tx, purchase.id)).max).toBe("100.000");
  }));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: dispatch", () => {
  it("takes the stock out of the purchase's lot when dispatched", () => withRollback(async (tx) => {
    const { actor, buy, stock } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    expect(await stock()).toBe("90.000");
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, created.id));
    expect(row.status).toBe("dispatched");
    expect(row.dispatchedById).toBe(actor.id);
    // The purchase table's "stock left" for this purchase drops too.
    expect((await returnableForPurchase(tx, purchase.id)).stockLeft).toBe("90.000");
  }));

  it("puts the stock back when a dispatched return is cancelled", () => withRollback(async (tx) => {
    const { actor, buy, stock } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    const result = await cancelSupplierReturn(tx, { returnId: created.id, reason: "Truck turned back" }, actor.id);
    expect(result.stockRestored).toBe(true);
    expect(await stock()).toBe("100.000");
  }));

  it("refuses to dispatch twice or when the stock was used meanwhile", () => withRollback(async (tx) => {
    const { actor, buy, floor, soda } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    // Simulate production using 95 kg of the lot after the request.
    const { moveLotStock } = await import("@/lib/inventory/material-lots.server");
    await moveLotStock(tx, { ref: { materialType: "chemical", materialId: soda.id }, lotId: purchase.lotId!, warehouseId: floor.id, delta: "-95", sourceType: "mixing" });
    await expect(dispatchSupplierReturn(tx, { returnId: created.id }, actor.id)).rejects.toThrow("Only 5 kg of this purchase is left to send back");
    await tx.update(supplierReturns).set({ quantity: "5.000", totalAmount: "2500.00" }).where(eq(supplierReturns.id, created.id));
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    await expect(dispatchSupplierReturn(tx, { returnId: created.id }, actor.id)).rejects.toThrow("already dispatched");
  }));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: debit note", () => {
  async function dispatched(tx: Tx, paid: string) {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    if (paid !== "0") await tx.update(purchaseRecords).set({ paidAmount: paid }).where(eq(purchaseRecords.id, purchase.id));
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    return { ...f, purchase, created };
  }

  it("lowers what we owe on an unpaid purchase", () => withRollback(async (tx) => {
    const { actor, purchase, created } = await dispatched(tx, "0");
    expect(await previewDebitNote(tx, created.id)).toMatchObject({ value: "5000.00", owedBefore: "50000.00", applied: "5000.00", leftover: "0.00" });
    const done = await completeSupplierReturn(tx, { returnId: created.id }, actor.id);
    expect(done.debitNoteNumber).toMatch(/^DN-\d{4,}$/);
    expect(done).toMatchObject({ applied: "5000.00", refund: "0.00", credit: "0.00" });
    const [p] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchase.id));
    expect(p.returnedAmount).toBe("5000.00");
  }));

  it("on a paid purchase, splits the leftover into cash back and supplier credit", () => withRollback(async (tx) => {
    const { actor, supplier, created } = await dispatched(tx, "50000");
    const [cash] = await tx.insert(wallets).values({ id: `w-${created.id}`, name: "Cash in Hand", type: "cash", balance: "1000" }).returning();
    const done = await completeSupplierReturn(tx, { returnId: created.id, cashBack: "2000", refundWalletId: cash.id }, actor.id);
    expect(done).toMatchObject({ applied: "0.00", refund: "2000.00", credit: "3000.00" });
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, cash.id));
    expect(w.balance).toBe("3000.00");
    expect(await supplierCreditBalance(tx, supplier.id)).toBe("3000.00");
  }));

  it("needs an account for cash back and refuses more than the leftover", () => withRollback(async (tx) => {
    const { actor, created } = await dispatched(tx, "48000");
    await expect(completeSupplierReturn(tx, { returnId: created.id, cashBack: "100" }, actor.id)).rejects.toThrow("Pick the account");
    await expect(completeSupplierReturn(tx, { returnId: created.id, cashBack: "3000.01", refundWalletId: "x" }, actor.id)).rejects.toThrow("Cash back can't be more than");
  }));

  it("only completes dispatched returns", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    await expect(completeSupplierReturn(tx, { returnId: created.id }, actor.id)).rejects.toThrow("Mark it as dispatched first");
  }));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: void", () => {
  it("reverses stock, owed amount, cash back and credit", () => withRollback(async (tx) => {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    await tx.update(purchaseRecords).set({ paidAmount: "48000" }).where(eq(purchaseRecords.id, purchase.id));
    const [cash] = await tx.insert(wallets).values({ id: `w-${purchase.id}`, name: "Cash in Hand", type: "cash", balance: "0" }).returning();
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    await completeSupplierReturn(tx, { returnId: created.id, cashBack: "1000", refundWalletId: cash.id }, f.actor.id);
    // applied 2000, cash 1000, credit 2000

    const result = await voidSupplierReturn(tx, { returnId: created.id, reason: "Supplier rejected the goods" }, f.actor.id);
    expect(result.refundTakenBack).toBe("1000.00");
    expect(await f.stock()).toBe("100.000");
    const [p] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchase.id));
    expect(p.returnedAmount).toBe("0.00");
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, cash.id));
    expect(w.balance).toBe("0.00");
    expect(await supplierCreditBalance(tx, f.supplier.id)).toBe("0.00");
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, created.id));
    expect(row.status).toBe("voided");
  }));

  it("refuses when the credit was already spent", () => withRollback(async (tx) => {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    await tx.update(purchaseRecords).set({ paidAmount: "50000" }).where(eq(purchaseRecords.id, purchase.id));
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "6", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    await completeSupplierReturn(tx, { returnId: created.id }, f.actor.id); // credit 3000
    await tx.insert(supplierCreditMovements).values({ supplierId: f.supplier.id, kind: "used", amount: "-2500.00", performedById: f.actor.id });
    await expect(voidSupplierReturn(tx, { returnId: created.id, reason: "x" }, f.actor.id))
      .rejects.toThrow("Rs 2,500 of this return's credit was already used on later payments, so it can't be voided.");
  }));

  it("refuses to void anything not completed", () => withRollback(async (tx) => {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "6", reason: "Wet" }, f.actor.id);
    await expect(voidSupplierReturn(tx, { returnId: created.id, reason: "x" }, f.actor.id)).rejects.toThrow("Only a completed return");
  }));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier credit and purchase guards", () => {
  async function withCredit(tx: Tx) {
    const f = await supplierReturnFixture(tx);
    const first = await f.buy("100", "50000");
    await tx.update(purchaseRecords).set({ paidAmount: "50000" }).where(eq(purchaseRecords.id, first.id));
    const created = await requestSupplierReturn(tx, { purchaseId: first.id, quantity: "6", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    await completeSupplierReturn(tx, { returnId: created.id }, f.actor.id); // credit 3000
    const second = await f.buy("40", "21000"); // new price lot, owes 21000
    return { ...f, first, second, created };
  }

  it("pays part of a later purchase from supplier credit without touching any account", () => withRollback(async (tx) => {
    const { actor, supplier, second } = await withCredit(tx);
    const result = await applySupplierCredit(tx, { purchaseId: second.id, amount: "2000" }, actor.id);
    expect(result.balanceAfter).toBe("1000.00");
    const [p] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, second.id));
    expect(p.paidAmount).toBe("2000.00");
    const [payment] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, result.paymentId));
    expect(payment).toMatchObject({ method: "supplier_credit", walletId: null, supplierId: supplier.id });
  }));

  it("refuses more than the credit or more than is owed", () => withRollback(async (tx) => {
    const { actor, second } = await withCredit(tx);
    await expect(applySupplierCredit(tx, { purchaseId: second.id, amount: "3000.01" }, actor.id)).rejects.toThrow("Supplier credit is only");
    await tx.update(purchaseRecords).set({ paidAmount: "20000" }).where(eq(purchaseRecords.id, second.id));
    await expect(applySupplierCredit(tx, { purchaseId: second.id, amount: "1500" }, actor.id)).rejects.toThrow("Only Rs 1,000 is still owed");
  }));

  it("blocks edit and delete while a return is active, and gives credit back on delete", () => withRollback(async (tx) => {
    const { actor, supplier, first, second } = await withCredit(tx);
    await expect(assertPurchaseHasNoActiveReturn(tx, first.id)).rejects.toThrow(/This purchase has supplier return SR-\d+\. Cancel or void the return first\./);
    await expect(assertPurchaseHasNoActiveReturn(tx, second.id)).resolves.toBeUndefined();
    await applySupplierCredit(tx, { purchaseId: second.id, amount: "2000" }, actor.id);
    expect(await restoreCreditUsedOnPurchase(tx, second.id, actor.id)).toBe("2000.00");
    expect(await supplierCreditBalance(tx, supplier.id)).toBe("3000.00");
  }));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: list", () => {
  it("lists by work queue with counts", () => withRollback(async (tx) => {
    const { actor, supplier, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const a = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "5", reason: "Wet" }, actor.id);
    const b = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "5", reason: "Torn" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: b.id }, actor.id);
    const { rows, counts } = await listSupplierReturns(tx, { supplierId: supplier.id, queue: "to_dispatch" });
    expect(rows.map((r) => r.id)).toEqual([a.id]);
    expect(rows[0]).toMatchObject({ quantity: "5.000", totalAmount: "2500.00", unit: "kg", status: "requested", requestedByName: "Buyer" });
    expect(counts).toEqual({ to_dispatch: 1, dispatched: 1, done: 0 });
  }));
});
