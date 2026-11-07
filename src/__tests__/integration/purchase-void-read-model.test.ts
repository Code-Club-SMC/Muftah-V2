import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, chemicals, materialStock, purchaseRecords, suppliers, supplierPayments, warehouses } from "@/db";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { getSupplierDetailsFn } from "@/server-functions/suppliers/get-supplier-details-fn";
import { getSupplierPaginatedPurchasesFn } from "@/server-functions/suppliers/get-supplier-paginated-purchases-fn";
import { getSupplierPaginatedPaymentsFn } from "@/server-functions/suppliers/get-supplier-paginated-payments-fn";
import { getSupplierPaginatedOutstandingFn } from "@/server-functions/suppliers/get-supplier-paginated-outstanding-fn";
import { getPurchasesReportFn } from "@/server-functions/reports/purchases-report-fn";
import { withStockLeft } from "@/lib/suppliers/purchase-rows.server";
import { expenseFixture } from "./expense-fixture";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse(data: unknown): unknown } | ((data: unknown) => unknown) | undefined;
  const builder = { middleware: () => builder, inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (fn: (input: unknown) => unknown) => (input: { data?: unknown } = {}) => fn({ ...input, data: typeof validator === "function" ? validator(input.data) : validator?.parse(input.data) }) };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {}, requireSuppliersManageMiddleware: {}, requireSuppliersViewMiddleware: {}, requireReportsViewMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("voided purchase read models", () => {
  it("retains history and original payments without claiming stock, debt or report totals", async () => {
    const f = await expenseFixture("50000");
    const [floor] = await db.insert(warehouses).values({ name: f.id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
    const [supplier] = await db.insert(suppliers).values({ supplierName: f.id }).returning();
    const [chemical] = await db.insert(chemicals).values({ name: f.id, unit: "kg" }).returning();
    const buy = () => addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: chemical.id, supplierId: supplier.id,
      quantity: "100", cost: "7000", paymentMethod: f.cash.id, walletId: "", paymentStatus: "paid", amountPaid: "", notes: "", transactionId: "", bankName: "" }, context: f.context } as never);
    await buy();
    const [first] = await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, chemical.id));
    await buy();
    const second = (await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, chemical.id))).find(p => p.id !== first.id)!;
    expect(first.lotId).toBe(second.lotId);
    await deletePurchaseRecordFn({ data: { id: second.id, reason: "Duplicate" }, context: f.context } as never);
    const input = { data: { supplierId: supplier.id, page: 1, limit: 100 } };
    const history = await getSupplierPaginatedPurchasesFn(input);
    expect(history.data).toHaveLength(2);
    expect(history.data.find(p => p.id === first.id)?.stockLeft).toBe(100);
    expect(history.data.find(p => p.id === second.id)?.stockLeft).toBe(0);
    expect(await getSupplierDetailsFn({ data: { id: supplier.id } })).toMatchObject({ totalPurchases: 7000, totalPayments: 7000, balance: 0 });
    expect((await getSuppliersFn()).find(s => s.id === supplier.id)).toMatchObject({ totalPurchases: 7000, totalPayments: 7000, balance: 0 });
    expect((await getSupplierPaginatedOutstandingFn(input)).data).toEqual([]);
    const payments = (await getSupplierPaginatedPaymentsFn(input)).data;
    expect(payments).toHaveLength(2);
    expect(payments.find(p => p.purchaseId === second.id)).toMatchObject({ amount: "7000.00", purchase: { voidReason: "Duplicate", voidedBy: { name: f.actor.name }, voidRefundWallet: { name: f.cash.name } } });
    const report = await getPurchasesReportFn({ data: {} });
    expect(report.purchases.some(p => p.purchaseId === second.id)).toBe(false);
    expect(report.summary.totalCost).toBe(report.purchases.reduce((sum, p) => sum + p.cost, 0));
  });

  it("ignores retained voids in legacy allocation windows and lot claims", async () => {
    const f = await expenseFixture();
    const [floor] = await db.insert(warehouses).values({ name: f.id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0" }).returning();
    const [supplier] = await db.insert(suppliers).values({ supplierName: f.id }).returning();
    const [chemical] = await db.insert(chemicals).values({ name: f.id }).returning();
    const base = { supplierId: supplier.id, warehouseId: floor.id, materialType: "chemical", chemicalId: chemical.id, quantity: "100", cost: "100", unitCost: "1" };
    const [active] = await db.insert(purchaseRecords).values({ ...base, purchaseDate: new Date("2026-11-01") }).returning();
    const [voided] = await db.insert(purchaseRecords).values({ ...base, purchaseDate: new Date("2026-11-02"), voidedAt: new Date(), voidedById: f.actor.id, voidReason: "Legacy duplicate", voidRefundAmount: "0", voidSnapshot: { materialName: f.id, unit: "kg", supplierName: f.id } }).returning();
    await db.insert(materialStock).values({ warehouseId: floor.id, chemicalId: chemical.id, quantity: "100" });
    await db.insert(supplierPayments).values({ supplierId: supplier.id, purchaseId: voided.id, amount: "0" });
    expect(await withStockLeft([active, voided])).toMatchObject([{ id: active.id, stockLeft: 100 }, { id: voided.id, stockLeft: 0 }]);
  });
});
