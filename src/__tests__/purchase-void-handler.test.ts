import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { deleteSupplierFn } from "@/server-functions/suppliers/delete-supplier-fn";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { addPaymentFn } from "@/server-functions/suppliers/add-payment-fn";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), untouched: vi.fn(), lock: vi.fn(), move: vi.fn(), log: vi.fn() }));
vi.mock("@/db", async () => ({
  ...await import("@/db/schemas/supplier-schema"),
  ...await import("@/db/schemas/finance-schema"),
  ...await import("@/db/schemas/core-suppliers"),
  ...await import("@/db/schemas/inventory-schema"),
  db: { transaction: mocks.transaction, query: { suppliers: { findFirst: async () => ({ supplierName: "Supplier" }) } } },
}));
vi.mock("@/lib/middlewares", () => ({ requireSuppliersManageMiddleware: {}, requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: mocks.log }));
vi.mock("@/lib/inventory/material-lots.server", () => ({ lockMaterialStock: mocks.lock, purchaseIsUntouched: mocks.untouched, moveLotStock: mocks.move, findOrCreateLot: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse(data: unknown): unknown };
  const builder = { middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (fn: (input: unknown) => unknown) => async (input: { data: unknown }) => fn({ ...input, data: validator.parse(input.data) }),
  };
  return builder;
} }));

type Purchase = { id: string; supplierId: string; warehouseId: string; materialType: string; chemicalId: string;
  packagingMaterialId?: string;
  lotId: string; quantity: string; cost: string; unitCost: string; paidAmount: string; voidedAt: Date | null;
  voidReason?: string | null; invoiceNumber?: string | null; notes?: string | null;
  chemical: { id?: string; name: string; unit: string; lastSupplierId?: string | null } | null;
  packagingMaterial?: { id?: string; name: string; measuredInKg?: boolean; capacityUnit?: string; lastSupplierId?: string | null } | null;
  supplier: { supplierName: string }; warehouse?: { name: string }; [key: string]: unknown };
type SupplierRow = { id: string; supplierName: string; supplierShopName: string | null; email: string | null; phone: string | null; city: string | null; state: string | null };
let state: { purchase: Purchase | null; supplier: SupplierRow | null; remainingPurchases: Record<string, unknown>[];
  payments: { id: string; amount: string; walletId: string; method: null }[]; labReports: { id: string }[];
  balance: number; stock: number; expenses: Record<string, unknown>[]; transactions: Record<string, unknown>[];
  inventoryAuditLogs: Record<string, unknown>[] };
let events: string[];
let minimumWrites: Record<string, unknown>[];
let lastSupplierWrites: Record<string, unknown>[];
const context = { session: { user: { id: "actor", name: "Buyer" } } };
const remove = (extra: Record<string, string> = {}) => deletePurchaseRecordFn({ data: { id: "p", reason: "  Duplicate supplier entry  ", ...extra }, context } as never);

function transaction() {
  const rows = (table: string) => {
    if (table === "purchase_records") return state.purchase ? [state.purchase, ...state.remainingPurchases] : state.remainingPurchases;
    if (table === "supplier_payments") return state.payments;
    if (table === "chemical_lab_reports") return state.labReports;
    if (table === "chemicals") return state.purchase?.chemical ? [state.purchase.chemical] : [];
    if (table === "packaging_materials") return state.purchase?.packagingMaterial ? [state.purchase.packagingMaterial] : [];
    if (table === "suppliers") return state.supplier ? [state.supplier] : [];
    if (table === "wallets") return [{ id: "cash", balance: String(state.balance), name: "Cash" }];
    if (table === "expenses") return state.expenses.filter(row => !row.voidedAt);
    throw new Error(`Unexpected select ${table}`);
  };
  return {
    query: { purchaseRecords: { findFirst: async () => state.purchase },
      expenseCategories: { findFirst: async () => ({ id: "category", name: "Supplier Purchase", isActive: true }) },
      suppliers: { findFirst: async () => state.supplier } },
    select: () => {
      let table = "";
      const builder = { from: (value: Parameters<typeof getTableName>[0]) => { table = getTableName(value); events.push(`read:${table}`); return builder; },
        where: () => builder, limit: () => builder, for: (mode: string) => { events.push(`lock:${table}:${mode}`); return builder; },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows(table)).then(resolve, reject) };
      return builder;
    },
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (values: Record<string, unknown>) => ({ where: async () => {
      const name = getTableName(table);
      events.push(`update:${name}`);
      if (name === "purchase_records" && state.purchase) Object.assign(state.purchase, values);
      if (name === "chemicals" || name === "packaging_materials") {
        if ("minimumStockLevel" in values && values.minimumStockLevel !== undefined) minimumWrites.push(values);
        if ("lastSupplierId" in values) lastSupplierWrites.push({ table: name, ...values });
      }
      if (name === "expenses") Object.assign(state.expenses[0], values);
      if (name === "wallets") {
        const query = new PgDialect().sqlToQuery(values.balance as never);
        const amount = Number(query.params[0]);
        state.balance += query.sql.includes(" + ") ? amount : -amount;
      }
    } }) }),
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (values: Record<string, unknown>) => {
      const name = getTableName(table);
      events.push(`insert:${name}`);
      if (name === "transactions") state.transactions.push(values);
      if (name === "expenses") state.expenses.push(values);
      if (name === "supplier_payments") state.payments.push(values as never);
      if (name === "inventory_audit_log") state.inventoryAuditLogs.push(values);
      const result = Promise.resolve();
      return Object.assign(result, { returning: async () => [values] });
    } }),
    delete: (table: Parameters<typeof getTableName>[0]) => ({ where: async () => {
      const name = getTableName(table);
      events.push(`delete:${name}`);
      if (name === "purchase_records") state.purchase = null;
      if (name === "supplier_payments") state.payments = [];
      if (name === "suppliers") state.supplier = null;
    } }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  minimumWrites = [];
  lastSupplierWrites = [];
  state = { purchase: { id: "p", supplierId: "supplier", warehouseId: "floor", materialType: "chemical", chemicalId: "c", lotId: "lot",
    quantity: "100.000", cost: "7000.00", unitCost: "70.00", paidAmount: "7000.00", voidedAt: null,
    chemical: { id: "c", name: "Soda", unit: "kg", lastSupplierId: null },
    supplier: { supplierName: "Supplier" }, warehouse: { name: "Factory Floor" } },
    supplier: { id: "supplier", supplierName: "Supplier", supplierShopName: "Shop", email: null, phone: "0300", city: "Lahore", state: "Punjab" },
    remainingPurchases: [],
    payments: [{ id: "payment", amount: "7000.00", walletId: "cash", method: null }], labReports: [],
    balance: 13000, stock: 100,
    expenses: [{ id: "expense", amount: "7000.00", voidedAt: null }], transactions: [], inventoryAuditLogs: [] };
  mocks.untouched.mockResolvedValue(true);
  mocks.move.mockImplementation(async (_tx, input) => { state.stock += Number(input.delta); });
  mocks.transaction.mockImplementation(async fn => {
    const original = structuredClone(state);
    try { return await fn(transaction()); } catch (error) { state = original; throw error; }
  });
});

describe("purchase deletion and supplier audit handler", () => {
  it("purchase edits update an explicit chemical minimum including zero, and retain it when absent", async () => {
    await updatePurchaseRecordFn({ data: { id: "p", minStock: "5.25" }, context } as never);
    expect(minimumWrites).toMatchObject([{ minimumStockLevel: "5.25" }]);
    minimumWrites = [];
    await updatePurchaseRecordFn({ data: { id: "p" }, context } as never);
    expect(minimumWrites).toEqual([]);
    await updatePurchaseRecordFn({ data: { id: "p", minStock: "0" }, context } as never);
    expect(minimumWrites).toMatchObject([{ minimumStockLevel: "0" }]);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      module: "suppliers",
      action: "updated",
      entityType: "purchase",
      entityId: "p",
    }));
  });
  it.each(["", "-1", "1junk", "Infinity", "100000000.01"])("rejects malformed purchase-edit threshold %s", async minStock => {
    await expect(updatePurchaseRecordFn({ data: { id: "p", minStock }, context } as never)).rejects.toThrow();
    expect(minimumWrites).toEqual([]);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("does not truncate fractional KG packaging thresholds during a purchase edit", async () => {
    state.purchase!.materialType = "packaging";
    state.purchase!.packagingMaterialId = "pkg";
    state.purchase!.packagingMaterial = { id: "pkg", name: "Bottle" };
    await expect(updatePurchaseRecordFn({ data: { id: "p", minStock: "1.5" }, context } as never)).rejects.toThrow(/whole number/);
    expect(minimumWrites).toEqual([]);
    await updatePurchaseRecordFn({ data: { id: "p", minStock: "2147483647" }, context } as never);
    expect(minimumWrites).toMatchObject([{ minimumStockLevel: 2147483647 }]);
  });
  it.each([["chemical", "1junk"], ["chemical", "1.001"], ["packaging", "1.5"], ["packaging", "2147483648"], ["packaging", ""]])("validates %s material threshold %s before writes", async (type, minimumStockLevel) => {
    await expect(updateMaterialFn({ data: { id: "material", type, data: { name: "Material", costPerUnit: "1", minimumStockLevel } }, context } as never)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([[undefined, 20000, "7000.00", "cash"], ["6500", 19500, "6500.00", "cash"], ["0", 13000, "0.00", null]] as const)(
    "permanently deletes unused purchase and payments and saves refund %s with audit log", async (refundAmount, balance, refunded, wallet) => {
      await remove(refundAmount === undefined ? {} : { refundAmount });
      expect(state.purchase).toBeNull();
      expect(state.payments).toEqual([]);
      expect(state.balance).toBe(balance);
      expect(state.stock).toBe(0);
      expect(state.inventoryAuditLogs).toHaveLength(1);
      expect(state.inventoryAuditLogs[0]).toMatchObject({ type: "debit", amount: "100.000", referenceId: "p" });
      expect(events.indexOf("lock:purchase_records:update")).toBeLessThan(events.indexOf("read:supplier_payments"));
      expect(events).toContain("delete:supplier_payments");
      expect(events).toContain("delete:purchase_records");
      expect(mocks.log).toHaveBeenCalledTimes(1);
      expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
        module: "suppliers",
        action: "deleted",
        entityType: "purchase",
        entityId: "p",
        severity: "warning",
        metadata: expect.objectContaining({
          refundAmount: refunded,
          refundWalletId: wallet,
          deletedPaymentCount: 1,
          reason: "Duplicate supplier entry",
        }),
      }));
      await expect(remove()).rejects.toThrow("Purchase record not found");
      expect(state.balance).toBe(balance);
      expect(mocks.move).toHaveBeenCalledTimes(1);
    });
  it.each(["", "  ", "x".repeat(1001)])("validates the reason before starting the transaction", async reason => {
    await expect(remove({ reason })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("keeps the used-stock restriction", async () => {
    mocks.untouched.mockResolvedValue(false);
    await expect(remove()).rejects.toThrow(/used|moved/i);
    expect(state.purchase).not.toBeNull();
    expect(state.balance).toBe(13000);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("blocks deleting a purchase while chemical lab reports are attached", async () => {
    state.labReports = [{ id: "rep-1" }];
    await expect(remove()).rejects.toThrow(/lab report/i);
    expect(state.purchase).not.toBeNull();
    expect(state.payments).toHaveLength(1);
    expect(state.balance).toBe(13000);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("updates material lastSupplierId to next active supplier or null when deleted purchase owned it", async () => {
    state.purchase!.chemical!.lastSupplierId = "supplier";
    state.remainingPurchases = [
      { supplierId: "older-supplier", purchaseDate: new Date("2026-10-01"), createdAt: new Date("2026-10-01") },
      { supplierId: "newer-supplier", purchaseDate: new Date("2026-11-01"), createdAt: new Date("2026-11-01") },
    ];
    await remove();
    expect(lastSupplierWrites).toMatchObject([{ table: "chemicals", lastSupplierId: "newer-supplier" }]);
  });
  it("clears material lastSupplierId to null when no active purchases remain", async () => {
    state.purchase!.chemical!.lastSupplierId = "supplier";
    await remove();
    expect(lastSupplierWrites).toMatchObject([{ table: "chemicals", lastSupplierId: null }]);
  });
  it("permanently deletes an unpaid purchase with zero refund and no wallet", async () => {
    state.purchase!.paidAmount = "0.00";
    state.payments = [];
    state.expenses = [];
    state.balance = 20000;
    await remove();
    expect(state.purchase).toBeNull();
    expect(state.payments).toHaveLength(0);
    expect(state.transactions).toHaveLength(0);
    expect(state.balance).toBe(20000);
    expect(state.stock).toBe(0);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", entityType: "purchase" }));
  });
  it("logs packaging units cleanly on packaging purchase delete", async () => {
    Object.assign(state.purchase!, { materialType: "packaging", packagingMaterialId: "pkg", chemical: null,
      packagingMaterial: { name: "Shopper", measuredInKg: true, capacityUnit: "ml" } });
    await remove();
    expect(state.purchase).toBeNull();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      entityLabel: "Shopper (100.000 kg)",
    }));
  });
  it("rolls back money, expenses, stock and audit log if reversal fails", async () => {
    mocks.move.mockRejectedValue(new Error("Stock reversal failed"));
    await expect(remove()).rejects.toThrow("Stock reversal failed");
    expect(state.balance).toBe(13000);
    expect(state.transactions).toHaveLength(0);
    expect(state.expenses[0].voidedAt).toBeNull();
    expect(state.purchase).not.toBeNull();
    expect(state.payments).toHaveLength(1);
    expect(state.inventoryAuditLogs).toHaveLength(0);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("rejects invalid refunds before writing", async () => {
    await expect(remove({ refundAmount: "7001" })).rejects.toThrow("more than what was paid");
    expect(state.balance).toBe(13000);
    expect(state.transactions).toHaveLength(0);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("exposes edit-state and allows permanently deleting a legacy voided row without double reversal", async () => {
    state.purchase!.voidedAt = new Date();
    state.purchase!.voidReason = "Old void";
    state.labReports = [{ id: "rep-1" }];
    expect(await getPurchaseEditStateFn({ data: { id: "p" }, context } as never)).toEqual({
      stockLocked: false,
      alreadyVoided: true,
      hasLabReports: true,
      refund: { paid: "0.00", walletId: null },
    });
    await expect(updatePurchaseRecordFn({ data: { id: "p", cost: "8000" }, context } as never)).rejects.toThrow("voided");
    await expect(remove()).rejects.toThrow(/lab report/i);
    state.labReports = [];
    await remove();
    expect(state.purchase).toBeNull();
    expect(state.payments).toEqual([]);
    expect(state.balance).toBe(13000);
    expect(state.stock).toBe(100);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(state.inventoryAuditLogs).toHaveLength(0);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      module: "suppliers",
      action: "deleted",
      entityType: "purchase",
      metadata: expect.objectContaining({ wasAlreadyVoided: true, previousVoidReason: "Old void" }),
    }));
  });
  it.each(["voided", "wrong supplier"])("checks %s under the purchase lock before inserting payment", async scenario => {
    if (scenario === "voided") state.purchase!.voidedAt = new Date();
    const supplierId = scenario === "wrong supplier" ? "other" : "supplier";
    await expect(addPaymentFn({ data: { supplierId, purchaseId: "p", amount: "1", walletId: "cash" }, context } as never)).rejects.toThrow(scenario === "voided" ? "voided" : "supplier");
    expect(events).toContain("lock:purchase_records:update");
    expect(events).not.toContain("insert:supplier_payments");
    expect(state.payments).toHaveLength(1);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("locks and computes the remaining payment balance before inserting", async () => {
    state.purchase!.paidAmount = "6999.00";
    await addPaymentFn({ data: { supplierId: "supplier", purchaseId: "p", amount: "1", walletId: "cash" }, context } as never);
    expect(events).toContain("lock:purchase_records:update");
    expect(events.indexOf("lock:purchase_records:update")).toBeLessThan(events.indexOf("insert:supplier_payments"));
    expect(state.payments).toHaveLength(2);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      module: "suppliers",
      action: "created",
      entityType: "payment",
    }));
  });
  it("rejects overpayment before inserting a payment or debiting the wallet", async () => {
    await expect(addPaymentFn({ data: { supplierId: "supplier", purchaseId: "p", amount: "1", walletId: "cash" }, context } as never)).rejects.toThrow("exceeds the outstanding balance");
    expect(events).toContain("lock:purchase_records:update");
    expect(events).not.toContain("insert:supplier_payments");
    expect(state.balance).toBe(13000);
  });
});

describe("supplier permanent deletion", () => {
  it("blocks deleting a supplier when purchase records exist", async () => {
    await expect(deleteSupplierFn({ data: { id: "supplier" }, context } as never)).rejects.toThrow(/purchase records/i);
    expect(state.supplier).not.toBeNull();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("blocks deleting a supplier when standalone payment records exist", async () => {
    state.purchase = null;
    await expect(deleteSupplierFn({ data: { id: "supplier" }, context } as never)).rejects.toThrow(/payment records/i);
    expect(state.supplier).not.toBeNull();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("clears stale material lastSupplierId, permanently deletes unused supplier, and records audit log", async () => {
    state.purchase = null;
    state.payments = [];
    await deleteSupplierFn({ data: { id: "supplier" }, context } as never);
    expect(state.supplier).toBeNull();
    expect(lastSupplierWrites).toEqual([
      { table: "chemicals", lastSupplierId: null, updatedAt: expect.any(Date) },
      { table: "packaging_materials", lastSupplierId: null, updatedAt: expect.any(Date) },
    ]);
    expect(mocks.log).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      module: "suppliers",
      action: "deleted",
      entityType: "supplier",
      entityId: "supplier",
      entityLabel: "Supplier",
      severity: "warning",
      metadata: expect.objectContaining({ supplierId: "supplier", supplierName: "Supplier" }),
    }));
  });
  it("throws Supplier not found when deleting a missing supplier", async () => {
    state.supplier = null;
    await expect(deleteSupplierFn({ data: { id: "missing" }, context } as never)).rejects.toThrow("Supplier not found");
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
