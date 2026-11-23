import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chemicals, db, formulaIngredients, formulas, packagingMaterials, products, purchaseRecords, recipes, suppliers, user, warehouses } from "@/db";
import { materialLots, materialLotStock, materialStock } from "@/db/schemas/inventory-schema";
import { listLotBalances, moveLotStock, takeLotPicks } from "@/lib/inventory/material-lots.server";
import { materialStockValue } from "@/lib/inventory/material-price.server";
import { withLiveEstimates } from "@/lib/production/cost-estimate.server";
import { purchaseStockLeft } from "@/lib/suppliers/purchase-rows.server";
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
  const ref = { materialType: "chemical" as const, materialId: soda.id };
  return {
    // Takes from the lots in the floor oldest first, as production does.
    use: (quantity: number) => db.transaction(async (tx) => {
      let left = quantity;
      const picks = (await listLotBalances(tx, floor.id, ref)).flatMap((lot) => {
        const take = Math.min(left, Number(lot.quantity));
        left -= take;
        return take > 0 ? [{ lotId: lot.lotId, quantity: String(take) }] : [];
      });
      return takeLotPicks(tx, { warehouseId: floor.id, ref, name: "MC", unit: "kg", required: String(quantity), picks, sourceType: "mixing", oldestFirst: true });
    }),
    transfer: (lotId: string, quantity: string) => db.transaction(async (tx) => {
      await moveLotStock(tx, { ref, lotId, warehouseId: floor.id, delta: `-${quantity}`, sourceType: "transfer_out" });
      await moveLotStock(tx, { ref, lotId, warehouseId: other.id, delta: quantity, sourceType: "transfer_in" });
    }),
    // Stock left per price, for example { "175.00": "228.000" }.
    lots: async (warehouseId = floor.id) => Object.fromEntries((await db.select({ price: materialLots.unitPrice, quantity: materialLotStock.quantity }).from(materialLotStock)
      .innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId)).where(and(eq(materialLots.chemicalId, soda.id), eq(materialLotStock.warehouseId, warehouseId), gt(materialLotStock.quantity, "0"))))
      .map((row) => [row.price, row.quantity])),
    left: async (purchaseId: string) => {
      const [row] = await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchaseId));
      return (await purchaseStockLeft(db, [row])).get(purchaseId);
    },
    // A purchase and its stock from before lots existed.
    buyBeforeLots: async (quantity: string, unitCost: string) => {
      const [row] = await db.insert(purchaseRecords).values({ supplierId: supplier.id, warehouseId: floor.id, materialType: "chemical", chemicalId: soda.id, quantity, unitCost, cost: String(Number(quantity) * Number(unitCost)), purchaseDate: new Date("2026-10-27T10:00:00Z") }).returning();
      await db.insert(materialStock).values({ warehouseId: floor.id, chemicalId: soda.id, quantity });
      return row;
    },
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

  it("moves the unused part of a purchase to its corrected price", async () => {
    const bill = await f.buy("chemical", "52560", "240"); // Rs 219
    const [taken] = await f.use(12);
    await f.edit(bill.id, { quantity: "240", cost: "42000" }); // Rs 175
    expect(taken.totalCost).toBe("2628.00");
    expect(await f.lots()).toEqual({ "175.00": "228.000" });
    expect(await f.left(bill.id)).toBe(228);
    expect((await f.use(12))[0].totalCost).toBe("2100.00");

    await f.edit(bill.id, { quantity: "240", cost: "43200" }); // Rs 180, corrected again
    expect(await f.lots()).toEqual({ "180.00": "216.000" });
    expect(await f.left(bill.id)).toBe(216);
    // Still locked: 24 kg of it is gone.
    await expect(f.edit(bill.id, { quantity: "216", cost: "38880" })).rejects.toThrow("already been used");
    await expect(f.remove(bill.id)).rejects.toThrow("already been used");
  });

  it("leaves another purchase at the same price alone", async () => {
    const older = await f.buy("chemical", "21900"); // 100 kg at Rs 219
    const newer = await f.buy("chemical", "21900"); // shares its lot
    await f.use(30); // from the older one
    await f.edit(older.id, { quantity: "100", cost: "17500" });
    expect(await f.lots()).toEqual({ "175.00": "70.000", "219.00": "100.000" });
    expect([await f.left(older.id), await f.left(newer.id)]).toEqual([70, 100]);
    expect((await f.use(10))[0].unitPrice).toBe("175.00"); // the older purchase is still used first
  });

  it("keeps each purchase's own share when a corrected part joins a lot", async () => {
    const first = await f.buy("chemical", "17500"); // 100 kg at Rs 175
    const second = await f.buy("chemical", "52560", "240"); // Rs 219
    const [lot] = await db.select().from(materialLots).where(and(eq(materialLots.chemicalId, f.soda.id), eq(materialLots.unitPrice, "219.00")));
    await db.transaction((tx) => takeLotPicks(tx, { warehouseId: f.floor.id, ref: { materialType: "chemical", materialId: f.soda.id }, name: "MC", unit: "kg", required: "12", picks: [{ lotId: lot.id, quantity: "12" }], sourceType: "mixing" }));
    await f.edit(second.id, { quantity: "240", cost: "42000" });
    expect(await f.lots()).toEqual({ "175.00": "328.000" });
    expect([await f.left(first.id), await f.left(second.id)]).toEqual([100, 228]);
  });

  it("does nothing to stock once the purchase is fully used", async () => {
    const first = await f.buy("chemical", "21900");
    await f.buy("chemical", "21900");
    await f.use(100);
    await f.edit(first.id, { quantity: "100", cost: "17500" });
    expect(await f.lots()).toEqual({ "219.00": "100.000" });
  });

  it("follows stock moved to another store", async () => {
    const bill = await f.buy("chemical", "21900");
    await f.transfer(bill.lotId!, "40");
    await f.use(10);
    await f.edit(bill.id, { quantity: "100", cost: "17500" });
    expect(await f.lots()).toEqual({ "175.00": "50.000" });
    expect(await f.lots(f.other.id)).toEqual({ "175.00": "40.000" });
    await expect(f.remove(bill.id)).rejects.toThrow("already been used");
  });

  it("corrects purchases from before lots", async () => {
    const bill = await f.buyBeforeLots("240", "219");
    await f.editMaterial({ costPerUnit: "219" }); // opens the lot for the old stock
    await f.buy("chemical", "20000"); // 100 kg at Rs 200
    expect(await f.lots()).toEqual({ "219.00": "240.000", "200.00": "100.000" });
    await f.use(12);
    await f.edit(bill.id, { quantity: "240", cost: "42000" });
    expect(await f.lots()).toEqual({ "175.00": "228.000", "200.00": "100.000" });
    expect((await f.use(12))[0].unitPrice).toBe("175.00"); // still the oldest
    expect(await f.price()).toBe("200.00"); // the newest purchase still sets the current price
  });
});
