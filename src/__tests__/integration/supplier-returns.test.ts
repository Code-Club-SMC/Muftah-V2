import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { chemicals, materialStock, purchaseRecords, suppliers, user, warehouses } from "@/db";
import { supplierReturns } from "@/db/schemas/supplier-schema";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { cancelSupplierReturn, requestSupplierReturn, returnableForPurchase } from "@/lib/suppliers/supplier-returns.server";
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

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

export async function supplierReturnFixture(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: `${id}-Ali Traders` }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "500" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const buy = async (quantity: string, cost: string) => {
    await addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
    const rows = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    return rows.sort((a, b) => +b.createdAt - +a.createdAt)[0];
  };
  const stock = async () => {
    const [row] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, soda.id)));
    return row?.quantity ?? "0";
  };
  return { actor, floor, supplier, soda, context, buy, stock };
}

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
