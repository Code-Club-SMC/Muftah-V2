import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chemicals, db, formulaIngredients, formulas, packagingMaterials, products, purchaseRecords, recipes, suppliers, user, warehouses } from "@/db";
import { materialLots, materialStock } from "@/db/schemas/inventory-schema";
import { materialStockValue } from "@/lib/inventory/material-price.server";
import { withLiveEstimates } from "@/lib/production/cost-estimate.server";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";

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

const place = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function fixture() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor, other] = await db.insert(warehouses).values([{ ...place, name: id }, { ...place, name: `${id}-2` }]).returning();
  const [supplier] = await db.insert(suppliers).values({ supplierName: id }).returning();
  const [soda] = await db.insert(chemicals).values({ name: `${id} MC`, costPerUnit: "219" }).returning();
  const [shopper] = await db.insert(packagingMaterials).values({ name: `${id} shopper`, costPerUnit: "600", pricePerKg: "600", measuredInKg: true, weightPerPack: "6" }).returning();
  const [product] = await db.insert(products).values({ name: id }).returning();
  const [formula] = await db.insert(formulas).values({ productId: product.id, name: id, batchSize: "100", batchUnit: "kg", estimatedIngredientsCost: "2628" }).returning();
  const [ingredient] = await db.insert(formulaIngredients).values({ formulaId: formula.id, chemicalId: soda.id, quantityPerBatch: "12" }).returning();
  const [format] = await db.insert(recipes).values({ productId: product.id, formulaId: formula.id, name: id, batchSize: "100", batchUnit: "kg", fillAmount: "1", fillUnit: "kg", containerType: "pack", containerPackagingId: shopper.id, estimatedCostPerContainer: "9999" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const buy = async (materialType: "chemical" | "packaging", cost: string, quantity = "100") => {
    const materialId = materialType === "chemical" ? soda.id : shopper.id;
    await addStockFn({ data: { warehouseId: floor.id, materialType, materialId, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
    const rows = await db.select().from(purchaseRecords).where(eq(purchaseRecords.warehouseId, floor.id));
    return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
  };
  return {
    floor, other, soda, shopper, ingredient, buy,
    edit: (purchaseId: string, fields: Record<string, string>) => updatePurchaseRecordFn({ data: { id: purchaseId, ...fields }, context } as never),
    remove: (purchaseId: string) => deletePurchaseRecordFn({ data: { id: purchaseId, reason: "Wrong entry in test" }, context } as never),
    editMaterial: (fields: Record<string, unknown>) => updateMaterialFn({ data: { id: soda.id, type: "chemical", data: { name: soda.name, unit: "kg", minimumStockLevel: "0", packagingKind: null, ...fields } }, context } as never),
    price: async () => (await db.select().from(chemicals).where(eq(chemicals.id, soda.id)))[0].costPerUnit,
    estimate: async () => (await withLiveEstimates(db, [format]))[0].estimatedCostPerContainer,
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("material prices and cost estimates", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  // Other suites resolve "the" active factory floor.
  afterAll(async () => { for (const row of [f.floor, f.other]) await db.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, row.id)); });

  it("moves the estimate with each purchase, purchase edit and removal", async () => {
    expect(await f.estimate()).toBe("29.8800"); // 12 x 219 / 100 + 3.60 shopper
    const first = await f.buy("chemical", "21900");
    const second = await f.buy("chemical", "17500");
    expect(await f.price()).toBe("175.00");
    expect(await f.estimate()).toBe("24.6000");

    await f.edit(second.id, { quantity: "100", cost: "18000" });
    expect(await f.price()).toBe("180.00");
    await f.edit(first.id, { quantity: "100", cost: "30000" }); // an older purchase
    expect(await f.price()).toBe("180.00");

    await f.remove(second.id);
    expect(await f.price()).toBe("300.00");
  });

  it("keeps a typed price when an older purchase is removed, and ignores free stock", async () => {
    await f.buy("chemical", "21900");
    const second = await f.buy("chemical", "17500");
    await f.editMaterial({ costPerUnit: "190" });
    await f.remove(second.id);
    expect(await f.price()).toBe("190.00");
    await f.buy("chemical", "0");
    expect(await f.price()).toBe("190.00");
    await f.editMaterial({}); // renaming does not touch the price
    expect(await f.price()).toBe("190.00");
  });

  it("follows packaging prices and formula ingredients", async () => {
    await f.buy("packaging", "100000"); // Rs 1000 per kg, 6 g each
    expect(await f.estimate()).toBe("32.2800");
    const [shopper] = await db.select().from(packagingMaterials).where(eq(packagingMaterials.id, f.shopper.id));
    expect(shopper.pricePerKg).toBe("1000.00");
    await db.update(formulaIngredients).set({ quantityPerBatch: "6" }).where(eq(formulaIngredients.id, f.ingredient.id));
    expect(await f.estimate()).toBe("19.1400");
    await db.delete(formulaIngredients).where(eq(formulaIngredients.id, f.ingredient.id));
    expect(await f.estimate()).toBe("6.0000");
  });

  it("keeps old stock at the price it was bought for", async () => {
    const before = Number((await materialStockValue(db, "chemical")).value);
    // Stock from before lots, in another store.
    await db.insert(materialStock).values({ warehouseId: f.other.id, chemicalId: f.soda.id, quantity: "10" });
    const value = async () => Number((await materialStockValue(db, "chemical")).value) - before;
    expect(await value()).toBeCloseTo(2190);
    await f.buy("chemical", "17500");
    expect(await value()).toBeCloseTo(2190 + 17500);
    const lots = await db.select().from(materialLots).where(eq(materialLots.chemicalId, f.soda.id));
    expect(lots.map((lot) => lot.unitPrice).sort()).toEqual(["175.00", "219.00"]);
  });
});
