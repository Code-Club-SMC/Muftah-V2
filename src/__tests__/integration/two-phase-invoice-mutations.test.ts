import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, user, warehouses, products, packagingMaterials, recipes, finishedGoodsStock, cartons, adjustmentLog, customers, invoices, invoiceItems, inventoryAuditLog, wallets, payments, transactions, slipRecords } from "@/db";
import { formulas, mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { createInvoiceFn, updateInvoiceFn, deleteInvoiceFn } from "@/server-functions/sales/invoices-fn";
import { postInvoice } from "@/server-functions/sales/invoice-posting-service";
import { createInvoiceSchema } from "@/db/zod_schemas";
import { createSalesReturnFn, processSalesReturnFn } from "@/server-functions/sales/sales-returns-fn";
import { processReturn } from "@/lib/cartons/carton-extended.service";
import { closeBatch, topUpCarton } from "@/lib/cartons/carton.service";
import { discountRules, salesReturnStockTraces } from "@/db/schemas/sales-erp-schema";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";
import { getCartonAvailabilityFn } from "@/server-functions/inventory/get-carton-availability-fn";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";

// Only HTTP/session transport is bypassed. Real validation, callbacks, SQL,
// nested transactions, receipt and invoice/return accounting are exercised.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | ((data: unknown) => unknown);
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data: unknown; context: unknown }) =>
      handler({ ...input, data: typeof validator === "function" ? validator(input.data) : validator.parse(input.data) }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireSalesViewMiddleware: {}, requireSalesManageMiddleware: {}, requireInventoryManageMiddleware: {}, requireInventoryViewMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = Awaited<ReturnType<typeof seed>>;
const rollback = new Error("rollback invoice fixture");

async function invoke(fn: unknown, data: unknown, actorId: string): Promise<any> {
  const session = { user: { id: actorId, name: "Invoice test" } };
  return (fn as Function)({ data, context: { session, authContext: { session } } });
}

async function seed(tx: Tx, usesCartons = true) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: id, email: `${id}@test.invalid` }).returning();
  // The online handler intentionally resolves the configured factory floor.
  // Reuse it if present; every stock row is scoped to this rollback-only recipe.
  const warehouse = (await tx.select().from(warehouses)
    .where(and(eq(warehouses.type, "factory_floor"), eq(warehouses.isActive, true)))
    .limit(1).for("key share"))[0] ??
    (await tx.insert(warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning())[0];
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [primary] = await tx.insert(packagingMaterials).values({ name: `${id}-pack`, costPerUnit: "1" }).returning();
  const [master] = await tx.insert(packagingMaterials).values({ name: `${id}-carton`, type: "master", costPerUnit: "1" }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "20", batchUnit: "kg" }).returning();
  const [recipe] = await tx.insert(recipes).values({ productId: product.id, formulaId: formula.id, name: id, batchSize: "20", batchUnit: "kg", containerType: "pack", containerPackagingId: primary.id, cartonPackagingId: usesCartons ? master.id : null, containersPerCarton: usesCartons ? 4 : 0, fillAmount: "1000", fillUnit: "g" }).returning();
  const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "20", bulkUnit: "kg", status: "completed" }).returning();
  const [customer] = await tx.insert(customers).values({ name: id, customerType: "retailer" }).returning();
  return { actor, warehouse, recipe, run, customer, usesCartons };
}

async function withFixture(check: (tx: Tx, f: Fixture) => Promise<void>, usesCartons = true) {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Isolated TEST_DATABASE_URL required");
  try {
    await db.transaction(async tx => {
      const f = await seed(tx, usesCartons);
      const spy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try { await check(tx, f); } finally { spy.mockRestore(); }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

async function receive(tx: Tx, f: Fixture, units: number, cost = units * 10) {
  const [allocation] = await tx.insert(packagingAllocations).values({
    mixingRunId: f.run.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
    allocatedBulkQuantity: String(units), allocatedBulkUnit: "kg", allocatedChemicalCost: String(cost),
    targetContainers: units, completedContainers: units, status: "in_progress",
  }).returning();
  await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
  return allocation;
}

function line(f: Fixture, units: number, unitType: "units" | "carton" = "units") {
  return { recipeId: f.recipe.id, pack: f.recipe.name, unitType, numberOfUnits: unitType === "units" ? units : 0,
    numberOfCartons: unitType === "carton" ? units : 0, perCartonPrice: 40, retailPrice: 10 };
}

function request(f: Fixture, items: ReturnType<typeof line>[]) {
  return { customerId: f.customer.id, warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"), items };
}

async function approveGoodReturn(f: Fixture, invoiceId: string, invoiceItemId: string, quantities: number[]) {
  const salesReturn = await invoke(createSalesReturnFn, {
    invoiceId, reason: "Recorded cost regression", condition: "good",
    items: quantities.map(quantityReturned => ({ invoiceItemId, quantityReturned, refundPerUnit: 10 })),
  }, f.actor.id);
  await invoke(processSalesReturnFn, { returnId: salesReturn.id, action: "approve", notes: "Recorded cost regression" }, f.actor.id);
  return salesReturn;
}

async function readCartonAvailability(tx: Tx, f: Fixture) {
  // Bind the reader to the rollback fixture connection; SQL stays real.
  const spy = vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx) as typeof db.select);
  try {
    const rows = await invoke(getCartonAvailabilityFn, { warehouseId: f.warehouse.id }, f.actor.id);
    return rows.find((row: { recipeId: string }) => row.recipeId === f.recipe.id);
  } finally { spy.mockRestore(); }
}

async function assertStock(tx: Tx, f: Fixture, units: number, value = units * 10) {
  const stock = await tx.query.finishedGoodsStock.findFirst({ where: and(eq(finishedGoodsStock.recipeId, f.recipe.id), eq(finishedGoodsStock.warehouseId, f.warehouse.id)) });
  expect(stock).toBeDefined();
  expect(stock!.quantityCartons * (f.usesCartons ? 4 : 0) + stock!.quantityContainers).toBe(units);
  expect(Number(stock!.totalInventoryValue)).toBeCloseTo(value, 2);
  // A four-decimal WAC cannot reproduce every two-decimal total exactly.
  expect(Math.abs(Number(stock!.totalInventoryValue) - units * Number(stock!.weightedAverageCostPerPack)))
    .toBeLessThanOrEqual(units * 0.00005 + 0.005);
  if (f.usesCartons) {
    const physical = await tx.select().from(cartons).where(and(eq(cartons.recipeId, f.recipe.id), eq(cartons.warehouseId, f.warehouse.id), inArray(cartons.status, ["PARTIAL", "COMPLETE", "SEALED", "ON_HOLD"])));
    expect(physical.reduce((total, carton) => total + carton.currentPacks, 0)).toBe(units);
    const ledger = await tx.select({ total: sql<string>`coalesce(sum(${adjustmentLog.delta}), 0)` }).from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id)).where(and(eq(cartons.recipeId, f.recipe.id), eq(cartons.warehouseId, f.warehouse.id)));
    expect(Number(ledger[0].total)).toBe(units);
    const logs = await tx.select().from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id)).where(eq(cartons.recipeId, f.recipe.id));
    for (const row of logs) {
      expect(row.adjustment_log.batchId).toBeNull();
      expect(row.adjustment_log.packagingAllocationId).toBeTruthy();
    }
  }
  return stock!;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("reachable two-phase invoice mutations", () => {
  it.each([true, false])("preserves outside packs through invoice creation, edits and deletion (cartons: %s)", async usesCartons => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, usesCartons ? 4 : 100);
      if (usesCartons) {
        await tx.update(finishedGoodsStock).set({ quantityCartons: 26, quantityContainers: 0, quantityOutsidePacks: 100, totalInventoryValue: "1040" })
          .where(and(eq(finishedGoodsStock.recipeId, f.recipe.id), eq(finishedGoodsStock.warehouseId, f.warehouse.id)));
      }
      // No-carton legacy receipts start with outside tracking zero.
      const read = () => tx.query.finishedGoodsStock.findFirst({ where: and(eq(finishedGoodsStock.recipeId, f.recipe.id), eq(finishedGoodsStock.warehouseId, f.warehouse.id)) });
      if (!usesCartons) expect((await read())!.quantityOutsidePacks).toBe(0);
      const availability = await readCartonAvailability(tx, f);
      expect(availability.outsidePacks).toBe(100);
      expect(availability.totalPacks).toBe(usesCartons ? 104 : 100);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 60)]), f.actor.id);
      for (const sold of [60, 80, 20]) {
        if (sold !== 60) await invoke(updateInvoiceFn, { ...request(f, [line(f, sold)]), id: invoice.id }, f.actor.id);
        const stock = (await read())!;
        expect(stock.quantityOutsidePacks).toBe(100 - sold);
        expect(stock.quantityCartons * (usesCartons ? 4 : 0) + stock.quantityContainers).toBe((usesCartons ? 104 : 100) - sold);
        expect(Number(stock.totalInventoryValue)).toBe(((usesCartons ? 104 : 100) - sold) * 10);
      }
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      const stock = (await read())!;
      expect(stock.quantityOutsidePacks).toBe(100);
      expect(Number(stock.totalInventoryValue)).toBe(usesCartons ? 1040 : 1000);
      const physical = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      expect(physical.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(usesCartons ? 4 : 0);
    }, usesCartons);
  });

  it("preserves recorded zero cost when good sales returns restore stock", async () => {
    for (const usesCartons of [true, false]) {
      await withFixture(async (tx, f) => {
        await tx.update(recipes).set({ estimatedCostPerContainer: "7" }).where(eq(recipes.id, f.recipe.id));
        await receive(tx, f, 4, 0);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        expect(item.costOfGoodsSold).toBe("0.00");
        expect(item.costOfGoodsSoldPerUnit).toBe("0.0000");
        const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [2]);
        await assertStock(tx, f, 4, 0);
        const [trace] = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
        expect(trace.totalUnitsMoved).toBe(2);
        expect(trace.costPerUnit).toBe("0.0000");
        expect(trace.totalCost).toBe("0.00");
      }, usesCartons);
    }
  });

  it("restores the full recorded fractional invoice cost on a good sales return", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 3000, 100);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3000)]), f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(item.costOfGoodsSold).toBe("100.00");
      const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [3000]);
      await assertStock(tx, f, 3000, 100);
      const [trace] = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
      expect(trace.totalUnitsMoved).toBe(3000);
      expect(trace.costPerUnit).toBe("0.0333");
      expect(trace.totalCost).toBe("100.00");
      const savedInvoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
      expect(savedInvoice!.totalPrice).toBe(invoice.totalPrice);
    });
  });

  it("allocates fractional return cost across separate approvals without losing residual cents", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 3, 1);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3)]), f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      for (const [units, value, cost] of [[1, 0.33, "0.33"], [2, 0.67, "0.34"], [3, 1, "0.33"]] as const) {
        const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [1]);
        await assertStock(tx, f, units, value);
        const [trace] = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
        expect(trace.totalUnitsMoved).toBe(1);
        expect(trace.costPerUnit).toBe("0.3333");
        expect(trace.totalCost).toBe(cost);
      }
      const traces = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.invoiceId, invoice.id));
      expect(traces.reduce((total, trace) => total + trace.totalUnitsMoved, 0)).toBe(3);
      expect(traces.reduce((total, trace) => total + Number(trace.totalCost), 0)).toBe(1);
      const savedInvoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
      expect(savedInvoice!.totalPrice).toBe(invoice.totalPrice);
    });
  });

  it("allocates fractional residual cents to duplicate return rows within one approval", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 3, 1);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3)]), f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [1, 1, 1]);
      await assertStock(tx, f, 3, 1);
      const traces = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
      expect(traces).toHaveLength(3);
      expect(traces.reduce((total, trace) => total + trace.totalUnitsMoved, 0)).toBe(3);
      expect(traces.map(trace => trace.costPerUnit)).toEqual(["0.3333", "0.3333", "0.3333"]);
      expect(traces.map(trace => trace.totalCost).sort()).toEqual(["0.33", "0.33", "0.34"]);
      expect(traces.reduce((total, trace) => total + Number(trace.totalCost), 0)).toBe(1);
    });
  });

  it("round-trips full and edited invoices without losing recorded fractional-WAC value", async () => {
    for (const usesCartons of [true, false]) {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 3000, 100);
        await assertStock(tx, f, 3000, 100);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3000)]), f.actor.id);
        await assertStock(tx, f, 0, 0);
        const [original] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        expect(original.costOfGoodsSold).toBe("100.00");
        for (const [units, remainingValue, cost] of [[1000, 66.67, "33.33"], [3000, 0, "100.00"]] as const) {
          await invoke(updateInvoiceFn, { ...request(f, [line(f, units)]), id: invoice.id }, f.actor.id);
          await assertStock(tx, f, 3000 - units, remainingValue);
          const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
          expect(item.costOfGoodsSold).toBe(cost);
        }
        await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
        await assertStock(tx, f, 3000, 100);
      }, usesCartons);
    }
  });

  it("allocates currency residuals across repeated recipe lines and conserves value on edit and deletion", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 3, 1);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1), line(f, 1)]), f.actor.id);
      await assertStock(tx, f, 1, 0.33);
      const original = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(original.map(item => item.costOfGoodsSold).sort()).toEqual(["0.33", "0.34"]);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1), line(f, 1), line(f, 1)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 0, 0);
      const updated = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(updated.reduce((total, item) => total + Number(item.costOfGoodsSold), 0)).toBe(1);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 2, 0.67);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 3, 1);
    });
  });

  it("preserves signed offline historical COGS while deducting the live recorded stock value", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 3000, 100);
      const input = createInvoiceSchema.parse(request(f, [line(f, 3000)]));
      const invoice = await postInvoice(tx, { ...input, performedById: f.actor.id,
        source: "offline_import", businessDate: new Date(), publicInvoiceNumber: randomUUID(),
        stockPolicy: "offline_reconcile", creditPolicy: "warn", pricingPolicy: "signed_snapshot",
        signedLineSnapshots: [{ stagedItemId: randomUUID(), recipeId: f.recipe.id,
          baseCartonPrice: 40, freeCartons: 0, chargedUnits: 3000, dispatchedUnits: 3000,
          lineAmount: 30000, wacPerPack: 0.02, stockUnitsSnapshot: 3000 }],
      });
      await assertStock(tx, f, 0, 0);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(item.costOfGoodsSold).toBe("60.00");
      expect(item.costOfGoodsSoldPerUnit).toBe("0.0200");
      await expect(invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id)).rejects.toThrow("Offline invoices cannot");
      await expect(invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id)).rejects.toThrow("Offline invoices cannot");
      // Returns follow the immutable signed cost, even when live stock debit differs.
      const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [3000]);
      await assertStock(tx, f, 3000, 60);
      const [trace] = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
      expect(trace.totalCost).toBe("60.00");
      expect(trace.costPerUnit).toBe("0.0200");
      const savedItem = await tx.query.invoiceItems.findFirst({ where: eq(invoiceItems.id, item.id) });
      expect(savedItem!.costOfGoodsSold).toBe("60.00");
      const savedInvoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
      expect(savedInvoice!.totalPrice).toBe(invoice.totalPrice);
    });
  });

  it("creates and increases an invoice from sealed allocation cartons", async () => {
    await withFixture(async (tx, f) => {
      const allocation = await receive(tx, f, 8);
      await closeBatch(allocation.id, f.actor.id);
      expect((await tx.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id)))
        .map(carton => carton.status)).toEqual(["SEALED", "SEALED"]);
      expect(await readCartonAvailability(tx, f)).toEqual({ recipeId: f.recipe.id, completeCartons: 2, partialCartons: 0, totalPacks: 8, outsidePacks: 0 });
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1, "carton")]), f.actor.id);
      await assertStock(tx, f, 4);
      expect((await tx.select().from(cartons).where(and(eq(cartons.packagingAllocationId, allocation.id), eq(cartons.status, "SEALED"))))).toHaveLength(1);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 2, "carton")]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 0);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(item.dispatchedUnits).toBe(8);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 8);
    });
  });

  it("edits an invoice using restored complete and untouched sealed cartons together", async () => {
    await withFixture(async (tx, f) => {
      const allocation = await receive(tx, f, 8);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1, "carton")]), f.actor.id);
      await closeBatch(allocation.id, f.actor.id);
      expect((await tx.select().from(cartons).where(and(eq(cartons.packagingAllocationId, allocation.id), eq(cartons.status, "SEALED"))))).toHaveLength(1);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 2, "carton")]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 0);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 8);
    });
  });

  it("counts only standard full cartons while including nonstandard sealed packs in invoice availability", async () => {
    await withFixture(async (tx, f) => {
      const allocation = await receive(tx, f, 6);
      // A full small carton is eligible as loose packs, not a standard recipe carton.
      await tx.update(cartons).set({ capacity: 2, status: "COMPLETE" }).where(and(eq(cartons.packagingAllocationId, allocation.id), eq(cartons.currentPacks, 2)));
      await closeBatch(allocation.id, f.actor.id);
      expect(await readCartonAvailability(tx, f)).toEqual({ recipeId: f.recipe.id, completeCartons: 1, partialCartons: 1, totalPacks: 6, outsidePacks: 0 });
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1, "carton")]), f.actor.id);
      await assertStock(tx, f, 2);
      expect(await readCartonAvailability(tx, f)).toEqual({ recipeId: f.recipe.id, completeCartons: 0, partialCartons: 1, totalPacks: 2, outsidePacks: 0 });
    });
  });

  it("keeps explicit zero-cost receipts at zero value through invoice creation, edits and deletion", async () => {
    for (const usesCartons of [true, false]) {
      await withFixture(async (tx, f) => {
        // Nonzero recipe estimates and selling rates must not replace recorded WAC=0.
        await tx.update(recipes).set({ estimatedCostPerContainer: "7" }).where(eq(recipes.id, f.recipe.id));
        await receive(tx, f, 4, 0);
        await assertStock(tx, f, 4, 0);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
        const assertZeroCogs = async () => {
          const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
          expect(Number(item.costOfGoodsSoldPerUnit)).toBe(0);
          expect(Number(item.costOfGoodsSold)).toBe(0);
        };
        await assertStock(tx, f, 3, 0);
        await assertZeroCogs();
        for (const units of [2, 1]) {
          await invoke(updateInvoiceFn, { ...request(f, [line(f, units)]), id: invoice.id }, f.actor.id);
          await assertStock(tx, f, 4 - units, 0);
          await assertZeroCogs();
        }
        await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
        const restored = await assertStock(tx, f, 4, 0);
        expect(Number(restored.weightedAverageCostPerPack)).toBe(0);
        expect(Number(restored.weightedAverageCostPerCarton)).toBe(0);
      }, usesCartons);
    }
  });

  it("reverses and redispatches partial cartons on unchanged, increased and decreased edits, then deletes", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
      await assertStock(tx, f, 3);
      for (const units of [1, 2, 1]) {
        await invoke(updateInvoiceFn, { ...request(f, [line(f, units)]), id: invoice.id }, f.actor.id);
        await assertStock(tx, f, 4 - units);
        const updated = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id), with: { items: true } });
        expect(updated?.items[0].dispatchedUnits).toBe(units);
        expect(Number(updated?.totalPrice)).toBe(units * 10);
      }
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 4);
      expect(await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) })).toBeUndefined();
      const evidence = await tx.select().from(adjustmentLog).where(eq(adjustmentLog.reconciliationId, invoice.id));
      expect(evidence.some(entry => entry.type === "DISPATCH_PARTIAL")).toBe(true);
      expect(evidence.some(entry => entry.type === "INVOICE_REVERSAL")).toBe(true);
      expect(evidence.every(entry => entry.dispatchOrderId === null)).toBe(true);
      expect(evidence.reduce((total, entry) => total + entry.delta, 0)).toBe(0);
      await expect(invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id)).rejects.toThrow("Invoice not found");
      await assertStock(tx, f, 4);
      const customer = await tx.query.customers.findFirst({ where: eq(customers.id, f.customer.id) });
      expect(Number(customer?.totalSale)).toBe(0);
      expect(Number(customer?.outstandingAmount)).toBe(0);
    });
  });

  it("restores full cartons on edit and deletion without losing dispatch audit evidence", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 12);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1, "carton")]), f.actor.id);
      await assertStock(tx, f, 8);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 2, "carton")]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 4);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1, "carton")]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 8);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 12);
      const dispatches = await tx.select().from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id)).where(and(eq(cartons.recipeId, f.recipe.id), eq(adjustmentLog.type, "DISPATCH_FULL")));
      expect(dispatches.length).toBeGreaterThan(0);
    });
  });

  it("keeps loose-only receipts and invoice changes in finished goods without making cartons", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 7);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3)]), f.actor.id);
      await assertStock(tx, f, 4);
      for (const units of [5, 1]) {
        await invoke(updateInvoiceFn, { ...request(f, [line(f, units)]), id: invoice.id }, f.actor.id);
        await assertStock(tx, f, 7 - units);
      }
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 7);
      expect(await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id))).toHaveLength(0);
    }, false);
  });

  it("handles duplicate recipe lines cumulatively and rolls back an overselling edit", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 8);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1), line(f, 2)]), f.actor.id);
      await assertStock(tx, f, 5);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 2), line(f, 3)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 3);
      const before = await tx.select().from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id)).where(eq(cartons.recipeId, f.recipe.id));
      await expect(invoke(updateInvoiceFn, { ...request(f, [line(f, 5), line(f, 4)]), id: invoice.id }, f.actor.id)).rejects.toThrow("Not enough stock");
      await assertStock(tx, f, 3);
      expect(await tx.select().from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id)).where(eq(cartons.recipeId, f.recipe.id))).toEqual(before);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 8);
    });
  });

  it("restores dispatch cost into current WAC after another priced receipt", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4, 40);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
      await receive(tx, f, 4, 80);
      await assertStock(tx, f, 7, 110);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      const stock = await assertStock(tx, f, 8, 120);
      expect(Number(stock.weightedAverageCostPerPack)).toBe(15);
      const audit = await tx.select().from(inventoryAuditLog).where(and(eq(inventoryAuditLog.materialId, f.recipe.id), eq(inventoryAuditLog.referenceId, invoice.id)));
      expect(audit.some(row => row.type === "credit" && Number(row.amount) === 1)).toBe(true);
    });
  });

  it("blends historical cost before an edited invoice dispatches at the current WAC", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4, 40);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
      await receive(tx, f, 4, 80);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 2)]), id: invoice.id }, f.actor.id);
      const stock = await assertStock(tx, f, 6, 90);
      expect(Number(stock.weightedAverageCostPerPack)).toBe(15);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(Number(item.costOfGoodsSold)).toBe(30);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 8, 120);
    });
  });

  it("preserves allocation trace when reversal needs another carton because the source was topped up", async () => {
    await withFixture(async (tx, f) => {
      const allocation = await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
      const [source] = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      await topUpCarton(source.id, 1, f.actor.id, "Replace the dispatched pack");
      await assertStock(tx, f, 4);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 4);
      const [reversal] = await tx.select().from(adjustmentLog).where(and(eq(adjustmentLog.dispatchOrderId, invoice.id), eq(adjustmentLog.type, "INVOICE_REVERSAL")));
      expect(reversal.cartonId).not.toBe(source.id);
      expect(reversal.relatedCartonId).toBe(source.id);
      expect(reversal.packagingAllocationId).toBe(allocation.id);
      expect(reversal.batchId).toBeNull();
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 5);
    });
  });

  it("restores invoice dispatch into its original warehouse after the source carton was transferred", async () => {
    await withFixture(async (tx, f) => {
      const allocation = await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
      const [source] = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      const [destination] = await tx.insert(warehouses).values({ name: randomUUID(), address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "regular" }).returning();
      await invoke(transferStockFn, { fromWarehouseId: f.warehouse.id, toWarehouseId: destination.id,
        materialType: "finished", materialId: f.recipe.id, quantity: "0", looseUnits: "3", notes: "Move the original invoice carton" }, f.actor.id);
      expect((await tx.query.cartons.findFirst({ where: eq(cartons.id, source.id) }))?.warehouseId).toBe(destination.id);
      await assertStock(tx, f, 0);
      await assertStock(tx, { ...f, warehouse: destination }, 3);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 0);
      await assertStock(tx, { ...f, warehouse: destination }, 3);
      const [reversal] = await tx.select().from(adjustmentLog).where(and(eq(adjustmentLog.dispatchOrderId, invoice.id), eq(adjustmentLog.type, "INVOICE_REVERSAL")));
      expect(reversal.cartonId).not.toBe(source.id);
      expect(reversal.relatedCartonId).toBe(source.id);
      expect(reversal.packagingAllocationId).toBe(allocation.id);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 1);
      await assertStock(tx, { ...f, warehouse: destination }, 3);
    });
  });

  it("reverses free cartons and mixed unit lines using their dispatched quantities", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 12);
      await tx.update(customers).set({ customerType: "distributor" }).where(eq(customers.id, f.customer.id));
      await tx.insert(discountRules).values({ customerId: f.customer.id, recipeId: f.recipe.id,
        quantityThreshold: 1, freeUnits: 1, effectiveFrom: new Date("2020-01-01") });
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1, "carton"), line(f, 1)]), f.actor.id);
      await assertStock(tx, f, 3);
      const original = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      expect(original.find(item => item.numberOfCartons === 1)?.freeCartons).toBe(1);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1, "carton"), line(f, 2)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 2);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 12);
    });
  });

  it("rejects edits and deletion for reserved and approved sales returns", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      const salesReturn = await invoke(createSalesReturnFn, { invoiceId: invoice.id, reason: "Test return", condition: "good", items: [{ invoiceItemId: item.id, quantityReturned: 1, refundPerUnit: 10 }] }, f.actor.id);
      for (const approved of [false, true]) {
        if (approved) await invoke(processSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
        await expect(invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id)).rejects.toThrow("sales return activity");
        await expect(invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id)).rejects.toThrow("sales return activity");
        await assertStock(tx, f, approved ? 3 : 2);
      }
    });
  });

  it("rejects invoice changes after a manufacturing carton return instead of restocking twice", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
      const [carton] = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      await processReturn(invoice.id, [{ cartonId: carton.id, packsReturned: 1, condition: "GOOD" }], "Test return", f.actor.id);
      await assertStock(tx, f, 3);
      await expect(invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id)).rejects.toThrow("return activity");
      await expect(invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id)).rejects.toThrow("return activity");
      await assertStock(tx, f, 3);
    });
  });

  it("counts only the current dispatch when returning cartons after multiple invoice edits", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
      for (const units of [3, 1]) await invoke(updateInvoiceFn, { ...request(f, [line(f, units)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 3);
      const [carton] = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      await expect(processReturn(invoice.id, [{ cartonId: carton.id, packsReturned: 2, condition: "GOOD" }], "Too much", f.actor.id)).rejects.toThrow("remaining dispatch");
      await assertStock(tx, f, 3);
      await processReturn(invoice.id, [{ cartonId: carton.id, packsReturned: 1, condition: "GOOD" }], "Current dispatch", f.actor.id);
      await assertStock(tx, f, 4);
    });
  });

  it("approves a sales return against net dispatch after invoice edits", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3)]), f.actor.id);
      await invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      const salesReturn = await invoke(createSalesReturnFn, { invoiceId: invoice.id, reason: "Edited invoice", condition: "good", items: [{ invoiceItemId: item.id, quantityReturned: 1, refundPerUnit: 10 }] }, f.actor.id);
      await invoke(processSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
      await assertStock(tx, f, 4);
    });
  });

  it("preserves payments, wallet entries and settlement during edits and blocks payment-backed deletion", async () => {
    for (const method of ["cash", "bank_transfer"] as const) {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const [wallet] = await tx.insert(wallets).values({ id: randomUUID(), name: randomUUID(), type: method === "cash" ? "cash" : "bank" }).returning();
        const invoice = await invoke(createInvoiceFn, { ...request(f, [line(f, 2)]), payments: [{ method, walletId: wallet.id, amount: 10, reference: "Test reference", paymentDate: new Date() }] }, f.actor.id);
        const originalPayments = await tx.select().from(payments).where(eq(payments.invoiceId, invoice.id));
        const originalTransactions = await tx.select().from(transactions).where(eq(transactions.walletId, wallet.id));
        await invoke(updateInvoiceFn, { ...request(f, [line(f, 3)]), id: invoice.id, expenses: 2 }, f.actor.id);
        await assertStock(tx, f, 1);
        expect(await tx.select().from(payments).where(eq(payments.invoiceId, invoice.id))).toEqual(originalPayments);
        expect(await tx.select().from(transactions).where(eq(transactions.walletId, wallet.id))).toEqual(originalTransactions);
        const updated = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
        expect(Number(updated?.totalPrice)).toBe(32);
        expect(Number(updated?.paidAmount)).toBe(method === "cash" ? 10 : 0);
        expect(Number(updated?.outstandingAmount)).toBe(method === "cash" ? 22 : 32);
        const slip = await tx.query.slipRecords.findFirst({ where: eq(slipRecords.invoiceId, invoice.id) });
        expect(Number(slip?.invoiceAmount)).toBe(32);
        await expect(invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id)).rejects.toThrow(method === "cash" ? "confirmed payments" : "pending payments");
        await assertStock(tx, f, 1);
      });
    }
  });

  it("uses the active replacement factory floor and restores the original invoice warehouse on edit", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 1)]), f.actor.id);
      const [destination] = await tx.insert(warehouses).values({ name: randomUUID(), address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
      const moved = { ...f, warehouse: destination };
      await receive(tx, moved, 4);
      await tx.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, f.warehouse.id));
      await invoke(updateInvoiceFn, { ...request(moved, [line(f, 1)]), id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 4);
      await assertStock(tx, moved, 3);
      const updated = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
      expect(updated?.stockWarehouseId).toBe(destination.id);
      await invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id);
      await assertStock(tx, f, 4);
      await assertStock(tx, moved, 4);
    });
  });
});
