import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, user, warehouses, chemicals, suppliers, purchaseRecords, materialLots } from "@/db";
import { materialLotStock } from "@/db/schemas/inventory-schema";
import { PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";
import { takeLotPicks } from "@/lib/inventory/material-lots.server";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";

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

// Each call commits on its own, because the untouched check orders lot movements by time.
async function fixture() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await db.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [supplier] = await db.insert(suppliers).values({ supplierName: `${id}-supplier` }).returning();
  const [soda] = await db.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "115" }).returning();
  const ref = { materialType: "chemical" as const, materialId: soda.id };
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const buy = async (cost: string, quantity: string) => {
    await addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
    const records = await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    return records.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
  };
  const edit = (id: string, fields: Record<string, string>) => updatePurchaseRecordFn({ data: { id, ...fields }, context } as never);
  const remove = (id: string) => deletePurchaseRecordFn({ data: { id }, context } as never);
  const locked = async (id: string) => ((await getPurchaseEditStateFn({ data: { id }, context } as never)) as { stockLocked: boolean }).stockLocked;
  const record = async (id: string) => (await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, id)))[0];
  const lotAt = async (price: string) => {
    const [lot] = await db.select().from(materialLots).where(and(eq(materialLots.chemicalId, soda.id), eq(materialLots.unitPrice, price)));
    const [stock] = await db.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, lot.id), eq(materialLotStock.warehouseId, floor.id)));
    return { id: lot.id, quantity: stock?.quantity ?? "0.000" };
  };
  return { floor, soda, ref, buy, edit, remove, locked, record, lotAt };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("purchase edits and deletes with lots", () => {
  it("allows quantity and price edits until the stock is used, then only the bill", async () => {
    const { floor, soda, ref, buy, edit, remove, locked, record, lotAt } = await fixture();
    try {
      const p1 = await buy("11500", "100"); // Rs 115

      await edit(p1.id, { quantity: "90", cost: "10350" });
      expect((await lotAt("115.00")).quantity).toBe("90.000");
      expect(await locked(p1.id)).toBe(false);

      await edit(p1.id, { quantity: "90", cost: "10080" }); // Rs 112
      expect((await lotAt("115.00")).quantity).toBe("0.000");
      const lot112 = await lotAt("112.00");
      expect(lot112.quantity).toBe("90.000");
      expect((await record(p1.id)).lotId).toBe(lot112.id);

      await db.transaction((tx) => takeLotPicks(tx, {
        warehouseId: floor.id, ref, name: soda.name, unit: "kg", required: "60",
        picks: [{ lotId: lot112.id, quantity: "60" }], sourceType: "mixing",
      }));
      expect(await locked(p1.id)).toBe(true);
      await expect(edit(p1.id, { quantity: "80", cost: "8960" })).rejects.toThrow(PURCHASE_LOCKED_MESSAGE);
      await expect(remove(p1.id)).rejects.toThrow(PURCHASE_LOCKED_MESSAGE);

      await edit(p1.id, { quantity: "90", cost: "10000" });
      expect((await record(p1.id)).cost).toBe("10000.00");
      expect((await record(p1.id)).lotId).toBe(lot112.id);
      expect(await lotAt("112.00")).toEqual({ id: lot112.id, quantity: "30.000" });

      const p2 = await buy("5600", "50"); // Rs 112, joins the same lot
      expect((await lotAt("112.00")).quantity).toBe("80.000");
      expect(await locked(p2.id)).toBe(false);
      await remove(p2.id);
      expect((await lotAt("112.00")).quantity).toBe("30.000");
      expect(await record(p2.id)).toBeUndefined();
    } finally {
      // Switched off so suites running in parallel still find their own single active floor.
      await db.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, floor.id));
    }
  });
});
