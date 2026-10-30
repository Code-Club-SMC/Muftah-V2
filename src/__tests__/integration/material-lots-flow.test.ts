import { randomUUID } from "node:crypto";
import Big from "big.js";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, products, warehouses, chemicals, suppliers, materialStock } from "@/db";
import { materialLotMovements, materialLotStock, materialLots } from "@/db/schemas/inventory-schema";
import { formulas, formulaIngredients, mixingRuns } from "@/db/schemas/production-schema";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";
import { adjustStockFn } from "@/server-functions/inventory/stock/adjust-stock-fn";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
import { withRollback } from "./with-rollback";

// Only the session transport is replaced. Validation, handlers, locks and SQL are real.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown };
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: typeof validator) => {
        validator = schema;
        return builder;
      },
      handler:
        (handler: (input: unknown) => unknown) =>
        (input: { data: unknown; context: unknown }) =>
          handler({ ...input, data: validator.parse(input.data) }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireInventoryManageMiddleware: {},
  requireManufacturingRunManageMiddleware: {},
  requireAuthMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

type Ref = { materialType: "chemical"; materialId: string };

// For each store: the item total equals the sum of its lot rows, each lot's stock equals
// the sum of its movements in that store, and no lot stock is negative.
async function assertLotLedger(tx: Tx, warehouseIds: string[], ref: Ref) {
  const lots = await tx.select().from(materialLots).where(eq(materialLots.chemicalId, ref.materialId));
  const lotIds = lots.map((lot) => lot.id);
  for (const warehouseId of warehouseIds) {
    const lotRows = await tx.select().from(materialLotStock)
      .where(and(eq(materialLotStock.warehouseId, warehouseId), inArray(materialLotStock.lotId, lotIds)));
    const [total] = await tx.select().from(materialStock)
      .where(and(eq(materialStock.warehouseId, warehouseId), eq(materialStock.chemicalId, ref.materialId)));
    const lotSum = lotRows.reduce((sum, row) => sum.plus(row.quantity), Big(0));
    expect(Big(total?.quantity ?? 0).eq(lotSum)).toBe(true);
    for (const row of lotRows) {
      expect(Big(row.quantity).gte(0)).toBe(true);
      const movements = await tx.select().from(materialLotMovements)
        .where(and(eq(materialLotMovements.warehouseId, warehouseId), eq(materialLotMovements.lotId, row.lotId)));
      const movementSum = movements.reduce((sum, movement) => sum.plus(movement.delta), Big(0));
      expect(movementSum.eq(row.quantity)).toBe(true);
    }
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("material price lots, whole flow", () => {
  it("buys at two prices, transfers, mixes and adjusts with the ledger in balance", () => withRollback(async (tx) => {
    // Other floors are switched off inside the transaction so the adjustment finds the first floor.
    const id = randomUUID();
    await tx.update(warehouses).set({ isActive: false }).where(eq(warehouses.type, "factory_floor"));
    const [actor] = await tx.insert(user).values({ id, name: "Storekeeper", email: `${id}@test.invalid` }).returning();
    const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
    const [secondFloor] = await tx.insert(warehouses).values({ ...warehouseValues, name: `${id}-second` }).returning();
    const [supplier] = await tx.insert(suppliers).values({ supplierName: `${id}-supplier` }).returning();
    const [soda] = await tx.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "115" }).returning();
    const ref = { materialType: "chemical" as const, materialId: soda.id };
    const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: [] } };

    // 1. Buy 300 kg at Rs 115 and 500 kg at Rs 125.
    const purchase = (cost: string, quantity: string) => addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
    await purchase("34500", "300");
    await purchase("62500", "500");
    const lots = await tx.select().from(materialLots).where(eq(materialLots.chemicalId, soda.id));
    expect(lots.map((lot) => lot.unitPrice).sort()).toEqual(["115.00", "125.00"]);
    const lot115 = lots.find((lot) => lot.unitPrice === "115.00")!;
    const lot125 = lots.find((lot) => lot.unitPrice === "125.00")!;
    const [bought] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, soda.id)));
    expect(bought.quantity).toBe("800.000");

    // 2. Move 100 kg of the Rs 115 lot and 50 kg of the Rs 125 lot to the second floor.
    await transferStockFn({ data: { fromWarehouseId: floor.id, toWarehouseId: secondFloor.id, materialType: "chemical", materialId: soda.id, quantity: "150", looseUnits: "0", notes: "", lotPicks: [{ lotId: lot115.id, quantity: "100" }, { lotId: lot125.id, quantity: "50" }] }, context } as never);

    // 3. Start a 250 kg batch on the first floor, oldest first: all 200 kg left at Rs 115, then 50 kg at Rs 125.
    const [product] = await tx.insert(products).values({ name: id }).returning();
    const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "250", batchUnit: "kg" }).returning();
    await tx.insert(formulaIngredients).values({ formulaId: formula.id, chemicalId: soda.id, quantityPerBatch: "250" });
    const [run] = await tx.insert(mixingRuns).values({
      batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
      targetBulkQuantity: "250", bulkUnit: "kg", status: "scheduled",
    }).returning();
    await startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: soda.id, picks: [{ lotId: lot115.id, quantity: "200" }, { lotId: lot125.id, quantity: "50" }] }] }, context } as never);
    const [started] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, run.id));
    expect(started.totalChemicalCost).toBe("29250.00");

    // 4. Count short by 2 kg in the Rs 125 lot on the first floor.
    await tx.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, secondFloor.id));
    await adjustStockFn({ data: { materialType: "chemical", materialId: soda.id, lotId: lot125.id, adjustment: -2, reason: "count_short" }, context } as never);

    // 5. Lot stock per floor: first floor 0 + 398, second floor 100 + 50.
    const stockOf = async (warehouseId: string) =>
      (await tx.select().from(materialLotStock).where(eq(materialLotStock.warehouseId, warehouseId)))
        .map((row) => [row.lotId, row.quantity]).sort();
    expect(await stockOf(floor.id)).toEqual([[lot115.id, "0.000"], [lot125.id, "398.000"]].sort());
    expect(await stockOf(secondFloor.id)).toEqual([[lot115.id, "100.000"], [lot125.id, "50.000"]].sort());
    await assertLotLedger(tx, [floor.id, secondFloor.id], ref);
  }));
});
