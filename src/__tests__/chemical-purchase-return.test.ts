import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRawMaterialFn } from "@/server-functions/inventory/add-chemical-fn";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), nextPurchase: 0 }));
vi.mock("@/db", async () => ({
  ...(await import("@/db/schemas/inventory-schema")),
  ...(await import("@/db/schemas/supplier-schema")),
  ...(await import("@/db/schemas/core-suppliers")),
  ...(await import("@/db/schemas/finance-schema")),
  db: { transaction: mocks.transaction },
}));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
vi.mock("@/lib/inventory/material-lots.server", () => ({
  lockMaterialStock: vi.fn(),
  moveLotStock: vi.fn(),
  findOrCreateLot: async () => ({ id: "price-lot", unitPrice: "70.00" }),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse(value: unknown): unknown };
    const b = {
      middleware: () => b,
      inputValidator: (schema: typeof validator) => {
        validator = schema;
        return b;
      },
      handler:
        (fn: (input: unknown) => unknown) => (input: { data: unknown }) =>
          fn({ ...input, data: validator.parse(input.data) }),
    };
    return b;
  },
}));
const context = {
  session: { user: { id: "actor", name: "Buyer" } },
  authContext: { session: { user: { id: "actor", name: "Buyer" } } },
};
const payment = {
  paymentStatus: "unpaid",
  paymentMethod: "pay_later",
  walletId: "",
  amountPaid: "",
  notes: "",
  transactionId: "",
  bankName: "",
  supplierId: "supplier",
  warehouseId: "floor",
};
beforeEach(() => {
  mocks.nextPurchase = 0;
  const rows: Record<string, unknown[]> = {
    warehouses: [{ id: "floor", type: "factory_floor", isActive: true }],
    chemicals: [],
    suppliers: [{ supplierName: "Supplier" }],
    material_stock: [{ id: "stock", quantity: "100.000" }],
    packaging_materials: [{ id: "pkg", name: "Bottle" }],
  };
  const tx = {
    query: { warehouses: { findFirst: async () => rows.warehouses[0] } },
    select: () => {
      let table = "";
      const b = {
        from: (value: Parameters<typeof getTableName>[0]) => {
          table = getTableName(value);
          return b;
        },
        where: () => b,
        for: () => b,
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows[table] ?? []).then(resolve, reject),
      };
      return b;
    },
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown>) => {
        const name = getTableName(table);
        const row = {
          ...values,
          id:
            name === "purchase_records"
              ? `purchase-${++mocks.nextPurchase}`
              : "chemical",
        };
        if (name === "chemicals") rows.chemicals.push(row);
        return Object.assign(Promise.resolve(), {
          returning: async () => [row],
        });
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  mocks.transaction.mockImplementation((fn) => fn(tx));
});
describe("flat stock purchase results", () => {
  it.each(["0", "100"])(
    "returns a purchase reference only for positive initial stock %s",
    async (quantity) => {
      const result = await addRawMaterialFn({
        data: {
          ...payment,
          name: "Soda",
          unit: "kg",
          quantity,
          costPerUnit: "70",
          minimumStockLevel: "0",
          packagingType: "",
          packagingSize: "",
          invoiceNumber: "",
        },
        context,
      } as never);
      expect(result.id).toBe("chemical");
      expect(result.name).toBe("Soda");
      expect(result.purchase).toEqual(
        quantity === "0"
          ? null
          : {
              purchaseId: "purchase-1",
              chemicalId: "chemical",
              chemicalName: "Soda",
            },
      );
    },
  );
  it("keeps same-price restocks independent and returns null ownership for packaging", async () => {
    const initial = await addRawMaterialFn({
      data: {
        ...payment,
        name: "Soda",
        unit: "kg",
        quantity: "100",
        costPerUnit: "70",
        minimumStockLevel: "0",
        packagingType: "",
        packagingSize: "",
        invoiceNumber: "",
      },
      context,
    } as never);
    const buy = (materialType: string, materialId: string) =>
      addStockFn({
        data: {
          ...payment,
          materialType,
          materialId,
          quantity: "100",
          cost: "7000",
        },
        context,
      } as never);
    const second = await buy("chemical", initial.id);
    expect(second).toMatchObject({
      id: "stock",
      quantity: "100.000",
      purchase: {
        purchaseId: "purchase-2",
        chemicalId: "chemical",
        chemicalName: "Soda",
      },
    });
    expect((await buy("packaging", "pkg")).purchase).toBeNull();
  });
});
