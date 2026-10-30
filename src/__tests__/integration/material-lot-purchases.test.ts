import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, warehouses, chemicals, suppliers, purchaseRecords, materialLots } from "@/db";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { addRawMaterialFn } from "@/server-functions/inventory/add-chemical-fn";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { withRollback } from "./with-rollback";

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
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function fixture(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: `${id}-supplier` }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "115" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const purchase = (cost: string, quantity: string) => addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
  return { id, floor, supplier, soda, context, purchase };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("purchases into lots", () => {
  it("joins the lot of the same price and opens a new lot for a new price", () => withRollback(async (tx) => {
    const { soda, purchase } = await fixture(tx);
    await purchase("34500", "300"); // Rs 115
    await purchase("57500", "500"); // Rs 115 again
    await purchase("62500", "500"); // Rs 125
    const lots = await tx.select().from(materialLots).where(eq(materialLots.chemicalId, soda.id));
    expect(lots.map((lot) => lot.unitPrice).sort()).toEqual(["115.00", "125.00"]);
    const records = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    expect(records.every((record) => !!record.lotId)).toBe(true);
  }));

  it("refuses a similar new material name unless confirmed, and never creates -1 items", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await fixture(tx);
    const base = { name: `${id} Soda Ashh`, unit: "kg", costPerUnit: "125", quantity: "0", minimumStockLevel: "0", supplierId: supplier.id, warehouseId: floor.id, notes: "", invoiceNumber: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "", packagingType: "", packagingSize: "" };
    await expect(addRawMaterialFn({ data: base, context } as never)).rejects.toThrow(`Similar item already exists: "${id} Soda Ash"`);
    await addRawMaterialFn({ data: { ...base, confirmSimilarName: true }, context } as never);
    const created = await tx.select().from(chemicals).where(eq(chemicals.name, `${id} Soda Ashh`));
    expect(created).toHaveLength(1);
    const dashOne = await tx.select().from(chemicals).where(eq(chemicals.name, `${id} Soda Ash-1`));
    expect(dashOne).toHaveLength(0);
  }));
});
