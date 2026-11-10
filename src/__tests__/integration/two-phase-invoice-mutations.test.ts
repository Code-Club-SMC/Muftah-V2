import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, user, warehouses, products, packagingMaterials, recipes, finishedGoodsStock, cartons, adjustmentLog, customers, invoices, invoiceItems, inventoryAuditLog, wallets, payments, transactions, slipRecords, returnedFinishedGoodsStock } from "@/db";
import { formulas, mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { createInvoiceFn, updateInvoiceFn, deleteInvoiceFn } from "@/server-functions/sales/invoices-fn";
import { postInvoice } from "@/server-functions/sales/invoice-posting-service";
import { createInvoiceSchema } from "@/db/zod_schemas";
import { cancelSalesReturnFn, completeSalesReturnFn, createSalesReturnFn, decideSalesReturnFn, voidSalesReturnFn } from "@/server-functions/sales/sales-returns-fn";
import { processReturn } from "@/lib/cartons/carton-extended.service";
import { closeBatch, topUpCarton } from "@/lib/cartons/carton.service";
import { discountRules, salesmen, salesReturnReasons, salesReturnItems, salesReturns, salesReturnStockTraces } from "@/db/schemas/sales-erp-schema";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";
import { getCartonAvailabilityFn } from "@/server-functions/inventory/get-carton-availability-fn";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { addPaymentsToInvoice } from "@/server-functions/sales/settlement-service";
import { generateDistributorLedgerFn } from "@/server-functions/sales/ledger-fn";
import { buildSnapshot, getCompanyReportData, loadContext } from "@/server-functions/reports/profit-loss/company-reporting-core";
import { createReportDateRange } from "@/server-functions/reports/profit-loss/reporting-math";
import { fetchScopedSummary } from "@/server-functions/reports/profit-loss/reporting-core";
import { exportPnlCsvFn } from "@/server-functions/reports/profit-loss/export-csv-fn";
import { formatReportMoney } from "@/lib/report-format";

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
vi.mock("@/lib/middlewares", () => ({ requireSalesViewMiddleware: {}, requireSalesManageMiddleware: {}, requireInventoryManageMiddleware: {}, requireInventoryViewMiddleware: {}, requireSalesReturnsCreateMiddleware: {}, requireSalesReturnsApproveMiddleware: {}, requireReturnsReceiveMiddleware: {}, requireReportsViewMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => ({}) }));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixture = Awaited<ReturnType<typeof seed>>;
const rollback = new Error("rollback invoice fixture");

async function invoke(fn: unknown, data: unknown, actorId: string, permissions: string[] = []): Promise<any> {
  const session = { user: { id: actorId, name: "Invoice test" } };
  return (fn as Function)({ data, context: { session, authContext: { session, permissions: new Set(permissions) } } });
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
  const [reason] = await tx.insert(salesReturnReasons).values({ name: id }).returning();
  return { actor, warehouse, recipe, run, customer, usesCartons, reason };
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

type CreatedReturn = { id: string; items: Array<{ id: string; quantityReturned: number }> };

async function requestReturn(f: Fixture, invoiceId: string, invoiceItemId: string, quantities: number[]): Promise<CreatedReturn> {
  return invoke(createSalesReturnFn, {
    invoiceId, reasonId: f.reason.id,
    items: quantities.map(quantityReturned => ({ invoiceItemId, quantityReturned, refundPerUnit: 10 })),
  }, f.actor.id);
}

// Named receiveReturn because receive(tx, f, units, cost) already receives packaging stock.
async function receiveReturn(f: Fixture, salesReturn: CreatedReturn, split: (units: number) => { goodUnits?: number; damagedUnits?: number; expiredUnits?: number } = units => ({ goodUnits: units })) {
  return invoke(completeSalesReturnFn, {
    returnId: salesReturn.id,
    lines: salesReturn.items.map(item => ({ returnItemId: item.id, ...split(item.quantityReturned) })),
  }, f.actor.id);
}

async function approveGoodReturn(f: Fixture, invoiceId: string, invoiceItemId: string, quantities: number[]) {
  const salesReturn = await requestReturn(f, invoiceId, invoiceItemId, quantities);
  await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
  await receiveReturn(f, salesReturn);
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

// Historical readers use the root DB. Bind them to the same rollback-only SQL
// connection, without mocking their queries, event expansion or accounting.
async function readAccounting<T>(tx: Tx, read: () => Promise<T>): Promise<T> {
  const spies: Array<{ mockRestore: () => void }> = [
    vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx) as typeof db.select),
    vi.spyOn(db, "insert").mockImplementation(tx.insert.bind(tx) as typeof db.insert),
  ];
  for (const name of ["invoices", "payments", "salesReturns", "slipRecords", "customers", "expenses", "orderBookers", "travelLogs", "recipes"] as const) {
    spies.push(vi.spyOn(db.query[name], "findMany").mockImplementation(tx.query[name].findMany.bind(tx.query[name]) as any));
  }
  spies.push(vi.spyOn(db.query.customers, "findFirst").mockImplementation(tx.query.customers.findFirst.bind(tx.query.customers)));
  try { return await read(); } finally { spies.forEach(spy => spy.mockRestore()); }
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
    const ledger = await tx.select({ total: sql<string>`coalesce(sum(${adjustmentLog.delta}), 0)` }).from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id)).where(and(eq(cartons.recipeId, f.recipe.id), eq(cartons.warehouseId, f.warehouse.id), ne(adjustmentLog.type, "RETURN_DAMAGED")));
    // Damaged returns are logged against the source carton but never re-enter sellable packs.
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

  it("rejects edits and deletion once a sales return exists, at every step", async () => {
    await withFixture(async (tx, f) => {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      const salesReturn = await requestReturn(f, invoice.id, item.id, [1]);
      for (const step of ["requested", "approved", "completed"] as const) {
        if (step === "approved") await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
        if (step === "completed") await receiveReturn(f, salesReturn);
        await expect(invoke(updateInvoiceFn, { ...request(f, [line(f, 1)]), id: invoice.id }, f.actor.id)).rejects.toThrow("sales return activity");
        await expect(invoke(deleteInvoiceFn, { id: invoice.id }, f.actor.id)).rejects.toThrow("sales return activity");
        await assertStock(tx, f, step === "completed" ? 3 : 2);
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
      await approveGoodReturn(f, invoice.id, item.id, [1]);
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

  describe("sales return lifecycle", () => {
    it.each([100, 900, 1000])("dates receipt and void independently after an intervening payment of %s", async paid => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 100, 600);
        const invoice = await invoke(createInvoiceFn, request(f, [{ ...line(f, 100), perCartonPrice: 10 }]), f.actor.id);
        expect(invoice.totalPrice).toBe("1000.00");
        await tx.update(invoices).set({ date: new Date("2026-01-15T12:00:00Z") }).where(eq(invoices.id, invoice.id));
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const salesReturn = await requestReturn(f, invoice.id, item.id, [10, 10]);
        await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
        const [wallet] = await tx.insert(wallets).values({ id: randomUUID(), name: randomUUID(), type: "cash" }).returning();
        await addPaymentsToInvoice(tx, { invoiceId: invoice.id, actorId: f.actor.id,
          payments: [{ method: "cash", walletId: wallet.id, amount: paid, paymentDate: new Date("2026-02-15T12:00:00Z") }] });
        if (paid === 100) {
          const [bank] = await tx.insert(wallets).values({ id: randomUUID(), name: randomUUID(), type: "bank" }).returning();
          await addPaymentsToInvoice(tx, { invoiceId: invoice.id, actorId: f.actor.id,
            payments: [{ method: "bank_transfer", walletId: bank.id, reference: "Pending synthetic payment", amount: 100, paymentDate: new Date("2026-02-16T12:00:00Z") }] });
          expect((await tx.query.wallets.findFirst({ where: eq(wallets.id, bank.id) }))!.balance).toBe("0.00");
        }
        const savedInvoice = () => tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
        const savedSlip = () => tx.query.slipRecords.findFirst({ where: eq(slipRecords.invoiceId, invoice.id) });
        expect([(await savedInvoice())!.returnedAmount, Number((await savedInvoice())!.outstandingAmount)]).toEqual(["0.00", 1000 - paid]);
        const originalPayments = await tx.select().from(payments).where(eq(payments.invoiceId, invoice.id));
        const originalMovements = await tx.select().from(transactions).where(eq(transactions.walletId, wallet.id));
        const ledger = (dateFrom: string, dateTo: string, extra = {}) => readAccounting(tx, () => invoke(generateDistributorLedgerFn,
          { customerId: f.customer.id, dateFrom, dateTo, ...extra }, f.actor.id));
        expect((await ledger("2026-01-01", "2026-02-28")).summary.periodReturns).toBe(0);

        const [collector] = await tx.insert(salesmen).values({ name: randomUUID() }).returning();
        await tx.update(slipRecords).set({ recoveryStatus: "in_progress", recoveryAssignedToId: collector.id,
          nextFollowUpDate: new Date("2026-03-02"), escalationLevel: 2 }).where(eq(slipRecords.invoiceId, invoice.id));
        await receiveReturn(f, salesReturn);
        await tx.update(salesReturns).set({ completedAt: new Date("2026-03-01T12:00:00Z") }).where(eq(salesReturns.id, salesReturn.id));
        expect(Number((await savedInvoice())!.outstandingAmount)).toBe(800 - paid);
        if (paid >= 900) {
          const slip = (await savedSlip())!;
          expect([slip.status, slip.recoveryStatus, slip.recoveryAssignedToId, slip.nextFollowUpDate, slip.escalationLevel]).toEqual(["closed", null, null, null, 0]);
          expect(slip.reconciledAt).not.toBeNull();
          await expect(tx.transaction(inner => addPaymentsToInvoice(inner, { invoiceId: invoice.id, actorId: f.actor.id,
            payments: [{ method: "cash", walletId: wallet.id, amount: 1, paymentDate: new Date() }] }))).rejects.toThrow("Payments cannot exceed invoice total");
        }
        const receiptStatement = await ledger("2026-03-01", "2026-03-31");
        expect(receiptStatement.summary).toMatchObject({ openingBalance: 1000 - paid, closingBalance: 800 - paid, periodReturns: 200, periodTotalProfit: -80 });
        const receipt = (await tx.query.salesReturns.findFirst({ where: eq(salesReturns.id, salesReturn.id) }))!;
        const receiptRange = createReportDateRange({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
        const receiptSnapshot = await readAccounting(tx, async () => buildSnapshot(await loadContext(receiptRange.fromDate, receiptRange.toDate, "online"), receiptRange));

        // Actual reversal cost differs after another priced receipt changes WAC.
        await receive(tx, f, 20, 240);
        await invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Wrong invoice received" }, f.actor.id);
        await tx.update(salesReturns).set({ voidedAt: new Date("2026-04-01T12:00:00Z") }).where(eq(salesReturns.id, salesReturn.id));
        expect(Number((await savedInvoice())!.outstandingAmount)).toBe(1000 - paid);
        expect((await savedSlip())!.status).toBe(paid === 1000 ? "closed" : "partially_recovered");
        expect((await savedInvoice())!.totalPrice).toBe("1000.00");
        expect((await savedSlip())!.invoiceAmount).toBe("1000.00");
        const voided = (await tx.query.salesReturns.findFirst({ where: eq(salesReturns.id, salesReturn.id) }))!;
        expect([voided.completedAt, voided.receivedById, voided.totalAmount]).toEqual([receipt.completedAt, receipt.receivedById, receipt.totalAmount]);
        expect(Number((await tx.query.customers.findFirst({ where: eq(customers.id, f.customer.id) }))!.outstandingAmount)).toBe(1000 - paid);
        expect(await tx.select().from(payments).where(eq(payments.invoiceId, invoice.id))).toEqual(originalPayments);
        expect(await tx.select().from(transactions).where(eq(transactions.walletId, wallet.id))).toEqual(originalMovements);
        expect((await tx.query.wallets.findFirst({ where: eq(wallets.id, wallet.id) }))!.balance).toBe(`${paid}.00`);
        expect((await ledger("2026-03-01", "2026-03-31")).summary).toEqual(receiptStatement.summary);
        const voidStatement = await ledger("2026-04-01", "2026-04-30", { typeFilter: "return", includeFullEntries: true, exportType: "csv" });
        expect(voidStatement.summary).toMatchObject({ openingBalance: 800 - paid, closingBalance: 1000 - paid, periodReturns: -200, periodTotalProfit: 20 });
        expect(voidStatement.entries).toMatchObject([{ id: `${salesReturn.id}:void`, type: "return", eventKind: "void", amount: 200 }]);
        expect((await ledger("2026-05-01", "2026-05-31")).summary.openingBalance).toBe(1000 - paid);

        await readAccounting(tx, async () => {
          const context = await loadContext(new Date("2026-01-01"), new Date("2026-04-30T23:59:59.999Z"), "online");
          expect(context.returns.map(event => [event.effectiveDate.toISOString(), event.totalRefund, event.totalCost, event.quantityReturned])).toEqual([
            ["2026-03-01T12:00:00.000Z", 100, 60, 10], ["2026-04-01T12:00:00.000Z", -100, -90, -10],
            ["2026-03-01T12:00:00.000Z", 100, 60, 10], ["2026-04-01T12:00:00.000Z", -100, -90, -10],
          ]);
          const voidOnly = await loadContext(new Date("2026-04-01"), new Date("2026-04-30T23:59:59.999Z"), "online");
          expect(voidOnly.lines.map(line => line.invoiceId)).toContain(invoice.id);
          const beforeVoid = await loadContext(new Date("2026-03-01"), new Date("2026-03-31T23:59:59.999Z"), "online");
          expect(beforeVoid.returns).toHaveLength(2);
          expect(buildSnapshot(beforeVoid, receiptRange)).toEqual(receiptSnapshot);
          const range = createReportDateRange({ dateFrom: "2026-04-01", dateTo: "2026-04-30" });
          const snapshot = buildSnapshot(voidOnly, range);
          expect(snapshot.summary.grossProfit).toBe(paid === 1000 ? 20 : paid === 900 ? -14 : -6);
          expect(snapshot.perProduct[0].profit).toBe(snapshot.summary.grossProfit);
          expect(snapshot.perRecipe[0].profit).toBe(snapshot.summary.grossProfit);
          const scope = { ...range, source: "online" as const };
          for (const filter of [{ productId: f.recipe.productId }, { recipeId: f.recipe.id }]) {
            expect((await fetchScopedSummary({ ...scope, ...filter })).grossProfit).toBe(snapshot.summary.grossProfit);
            const exported = await invoke(exportPnlCsvFn, { dateFrom: "2026-04-01", dateTo: "2026-04-30", source: "online", ...filter }, f.actor.id);
            expect(exported.csv).toContain(formatReportMoney(snapshot.summary.grossProfit));
          }
          const company = await getCompanyReportData({ dateFrom: "2026-04-01", dateTo: "2026-04-30", source: "online" });
          expect(company.summary).toEqual(snapshot.summary);
          expect(company.previousSummary).toEqual(receiptSnapshot.summary);
          expect(company.monthlyTrend.find(month => month.monthKey === "2026-04-01")!.grossProfit).toBe(snapshot.summary.grossProfit);
          const exported = await invoke(exportPnlCsvFn, { dateFrom: "2026-04-01", dateTo: "2026-04-30", source: "online" }, f.actor.id);
          expect(exported.csv).toContain(`Gross Profit,${formatReportMoney(snapshot.summary.grossProfit)}`);
          expect((await loadContext(new Date("2026-04-01"), new Date("2026-04-30T23:59:59.999Z"), "offline_import")).lines).toEqual([]);
        });
        // Synthetic source fixture, not a historical status/quantity conversion.
        await tx.update(invoices).set({ source: "offline_import" }).where(eq(invoices.id, invoice.id));
        await readAccounting(tx, async () => {
          const from = new Date("2026-04-01"), to = new Date("2026-04-30T23:59:59.999Z");
          expect((await loadContext(from, to, "online")).lines).toEqual([]);
          expect((await loadContext(from, to, "offline_import")).returns).toHaveLength(4);
        });
      }, false);
    });

    it("moves nothing until received, then credits only what arrived and closes the short part", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 10);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 4)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const salesReturn = await requestReturn(f, invoice.id, item.id, [3]);
        await assertStock(tx, f, 6);
        await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
        await assertStock(tx, f, 6);
        expect((await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) }))!.returnedAmount).toBe("0.00");

        await receiveReturn(f, salesReturn, () => ({ goodUnits: 1, damagedUnits: 1 }));
        await assertStock(tx, f, 7, 70);
        const [damaged] = await tx.select().from(returnedFinishedGoodsStock).where(and(
          eq(returnedFinishedGoodsStock.recipeId, f.recipe.id), eq(returnedFinishedGoodsStock.condition, "damaged")));
        expect(damaged.quantityCartons * 4 + damaged.quantityContainers).toBe(1);
        expect(damaged.totalInventoryValue).toBe("10.00");
        const saved = await tx.query.salesReturns.findFirst({ where: eq(salesReturns.id, salesReturn.id) });
        expect([saved!.status, saved!.totalAmount, saved!.receivedById]).toEqual(["completed", "20.00", f.actor.id]);
        const [savedItem] = await tx.select().from(salesReturnItems).where(eq(salesReturnItems.salesReturnId, salesReturn.id));
        expect([savedItem.quantityRequested, savedItem.goodUnits, savedItem.damagedUnits, savedItem.quantityReturned]).toEqual([3, 1, 1, 2]);
        expect((await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) }))!.returnedAmount).toBe("20.00");

        // The short pack is released: 4 sold − 2 received leaves 2 returnable.
        await expect(requestReturn(f, invoice.id, item.id, [3])).rejects.toThrow("remaining returnable");
        await requestReturn(f, invoice.id, item.id, [2]);
      });
    });

    it("enforces the order of steps and needs reasons to reject or cancel", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const first = await requestReturn(f, invoice.id, item.id, [2]);
        await expect(receiveReturn(f, first)).rejects.toThrow("is requested, so it can't be received");
        await expect(invoke(decideSalesReturnFn, { returnId: first.id, action: "reject" }, f.actor.id)).rejects.toThrow("Give a reason");
        await invoke(decideSalesReturnFn, { returnId: first.id, action: "reject", reason: "Not our goods" }, f.actor.id);

        const second = await requestReturn(f, invoice.id, item.id, [2]); // rejected one released its units
        await invoke(decideSalesReturnFn, { returnId: second.id, action: "approve" }, f.actor.id);
        await expect(invoke(decideSalesReturnFn, { returnId: second.id, action: "approve" }, f.actor.id)).rejects.toThrow("can't be approved");
        await invoke(cancelSalesReturnFn, { returnId: second.id, reason: "Customer kept them" }, f.actor.id);
        await expect(receiveReturn(f, second)).rejects.toThrow("is cancelled, so it can't be received");
        await assertStock(tx, f, 2);
        const statuses = await tx.select({ status: salesReturns.status }).from(salesReturns).where(eq(salesReturns.invoiceId, invoice.id));
        expect(statuses.map(row => row.status).sort()).toEqual(["cancelled", "rejected"]);
      });
    });

    it("keeps rejected and cancelled requests out of settlement after payments", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 4)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const rejected = await requestReturn(f, invoice.id, item.id, [2]);
        await invoke(decideSalesReturnFn, { returnId: rejected.id, action: "reject", reason: "Not our goods" }, f.actor.id);
        const cancelled = await requestReturn(f, invoice.id, item.id, [2]);
        await invoke(decideSalesReturnFn, { returnId: cancelled.id, action: "approve" }, f.actor.id);
        const [wallet] = await tx.insert(wallets).values({ id: randomUUID(), name: randomUUID(), type: "cash" }).returning();
        await addPaymentsToInvoice(tx, { invoiceId: invoice.id, actorId: f.actor.id,
          payments: [{ method: "cash", walletId: wallet.id, amount: 10, paymentDate: new Date() }] });
        const before = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
        expect([before!.returnedAmount, before!.outstandingAmount]).toEqual(["0.00", "30.00"]);
        await invoke(cancelSalesReturnFn, { returnId: cancelled.id, reason: "Customer kept the goods" }, f.actor.id);
        expect(await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) })).toEqual(before);
        expect(await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.invoiceId, invoice.id))).toEqual([]);
        await assertStock(tx, f, 0);
        await requestReturn(f, invoice.id, item.id, [4]);
      });
    });

    it("checks reasons and the right to approve on the spot", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const [other] = await tx.insert(salesReturnReasons).values({ name: `${f.reason.name}-other`, requiresNote: true }).returning();
        const [retired] = await tx.insert(salesReturnReasons).values({ name: `${f.reason.name}-old`, isActive: false }).returning();
        const base = { invoiceId: invoice.id, items: [{ invoiceItemId: item.id, quantityReturned: 1 }] };
        await expect(invoke(createSalesReturnFn, { ...base, reasonId: other.id }, f.actor.id)).rejects.toThrow("Add a note");
        await expect(invoke(createSalesReturnFn, { ...base, reasonId: retired.id }, f.actor.id)).rejects.toThrow("Pick a return reason");
        await expect(invoke(createSalesReturnFn, { ...base, reasonId: f.reason.id, approveNow: true }, f.actor.id)).rejects.toThrow("right to approve");
        const fast = await invoke(createSalesReturnFn, { ...base, reasonId: other.id, reasonNote: "Changed brand", approveNow: true }, f.actor.id, ["sales.returns.approve"]);
        expect([fast.status, fast.reason, fast.approvedById]).toEqual(["approved", `${other.name}: Changed brand`, f.actor.id]);
      });
    });

    it("voids a good return: packs leave stock again and the balance goes back up", async () => {
      for (const usesCartons of [true, false]) {
        await withFixture(async (tx, f) => {
          await receive(tx, f, 10);
          const invoice = await invoke(createInvoiceFn, request(f, [line(f, 4)]), f.actor.id);
          const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
          const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [2]);
          await assertStock(tx, f, 8);
          await expect(invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "x" }, f.actor.id)).rejects.toThrow("Give a reason");
          await invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Entered against the wrong invoice" }, f.actor.id);
          await assertStock(tx, f, 6);
          const saved = await tx.query.salesReturns.findFirst({ where: eq(salesReturns.id, salesReturn.id) });
          expect([saved!.status, saved!.voidReason, saved!.voidedById]).toEqual(["voided", "Entered against the wrong invoice", f.actor.id]);
          expect((await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) }))!.returnedAmount).toBe("0.00");
          const traces = await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
          expect(traces.map(trace => [trace.kind, trace.totalUnitsMoved, trace.totalCost]).sort()).toEqual([["receive", 2, "20.00"], ["void", -2, "-20.00"]]);
          await expect(invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Again please" }, f.actor.id)).rejects.toThrow("is voided, so it can't be voided");
          // The customer can send the same packs back again.
          await approveGoodReturn(f, invoice.id, item.id, [2]);
          await assertStock(tx, f, 8);
        }, usesCartons);
      }
    });

    it("blocks a void when the restocked packs were sold since", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 4)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const salesReturn = await approveGoodReturn(f, invoice.id, item.id, [2]);
        await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
        await assertStock(tx, f, 0, 0);
        const accounting = async () => ({
          invoice: await tx.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) }),
          slip: await tx.query.slipRecords.findFirst({ where: eq(slipRecords.invoiceId, invoice.id) }),
          customer: await tx.query.customers.findFirst({ where: eq(customers.id, f.customer.id) }),
          salesReturn: await tx.query.salesReturns.findFirst({ where: eq(salesReturns.id, salesReturn.id) }),
          traces: await tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id)),
        });
        const before = await accounting();
        await expect(invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Wrong invoice" }, f.actor.id))
          .rejects.toThrow("but only 0 are left");
        expect((await tx.query.salesReturns.findFirst({ where: eq(salesReturns.id, salesReturn.id) }))!.status).toBe("completed");
        expect(await accounting()).toEqual(before);
        await assertStock(tx, f, 0, 0);
      });
    });

    it("voids a damaged return and lets the same packs be returned again", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const damagedOnly = (units: number) => ({ damagedUnits: units });
        const first = await requestReturn(f, invoice.id, item.id, [2]);
        await invoke(decideSalesReturnFn, { returnId: first.id, action: "approve" }, f.actor.id);
        await receiveReturn(f, first, damagedOnly);
        await invoke(voidSalesReturnFn, { returnId: first.id, reason: "Counted twice" }, f.actor.id);
        const [damaged] = await tx.select().from(returnedFinishedGoodsStock).where(and(
          eq(returnedFinishedGoodsStock.recipeId, f.recipe.id), eq(returnedFinishedGoodsStock.condition, "damaged")));
        expect([damaged.quantityCartons, damaged.quantityContainers, damaged.totalInventoryValue]).toEqual([0, 0, "0.00"]);
        const second = await requestReturn(f, invoice.id, item.id, [2]);
        await invoke(decideSalesReturnFn, { returnId: second.id, action: "approve" }, f.actor.id);
        await receiveReturn(f, second, damagedOnly);
        await assertStock(tx, f, 2);
      });
    });
  });
});
