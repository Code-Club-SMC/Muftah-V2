import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { inventoryAuditLog } from "@/db";
import { appRoles, appPermissions, appRolePermissions, userRoleAssignments } from "@/db/schemas/rbac-schema";
import { getProductionOperators } from "@/lib/production/operator-assignment.server";
import { db, user, warehouses, products, chemicals, packagingMaterials, recipes, finishedGoodsStock, cartons, wacHistory, adjustmentLog, materialStock, returnedFinishedGoodsStock, stockCountLines, customers, invoices, failedProductionChemicalRecoveries, salesReturns, slipRecords, returnRecords, returnLines, priceChangeLog } from "@/db";
import { recipePackaging } from "@/db/schemas/inventory-schema";
import { formulas, formulaIngredients, mixingRuns, mixingMaterialsUsed, packagingAllocations, packagingProgressLogs, packagingMaterialsUsed } from "@/db/schemas/production-schema";
import { loadFailedProductionRecoveryContext } from "@/server-functions/inventory/stock/failed-production-recovery-core";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
import { createMixingRunFn } from "@/server-functions/manufacturing/mixing/create-mixing-run-fn";
import { logMixingProgressFn } from "@/server-functions/manufacturing/mixing/log-mixing-progress-fn";
import { completeMixingRunFn } from "@/server-functions/manufacturing/mixing/complete-mixing-run-fn";
import { failMixingRunFn } from "@/server-functions/manufacturing/mixing/fail-mixing-run-fn";
import { createPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/create-packaging-allocation-fn";
import { startPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/start-packaging-allocation-fn";
import { logPackagingProgressFn } from "@/server-functions/manufacturing/packaging/log-packaging-progress-fn";
import { cancelPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/cancel-packaging-allocation-fn";
import { postInvoice } from "@/server-functions/sales/invoice-posting-service";
import { createInvoiceSchema } from "@/db/zod_schemas";
import { createSalesReturnFn, processSalesReturnFn } from "@/server-functions/sales/sales-returns-fn";
import { recoverFailedProductionChemicalFn } from "@/server-functions/inventory/stock/recover-failed-production-chemical-fn";
import { createRecipeFn } from "@/server-functions/inventory/recipes/create-recipe-fn";
import { updateRecipeFn } from "@/server-functions/inventory/recipes/update-recipe-fn";
import { updateFormulaFn } from "@/server-functions/manufacturing/formulas/update-formula-fn";
import { deleteFormulaFn } from "@/server-functions/manufacturing/formulas/delete-formula-fn";
import { topUpCarton, removePacksFromCarton, setCartonCount, retireCarton, applyQcHold, releaseQcHold, transferPacks, mergeCartons, closeBatch, reopenBatch, addCartonsToBatch, repackCarton } from "@/lib/cartons/carton.service";
import { executeBulkOperation } from "@/lib/cartons/bulk.service";
import { dispatchCartons, processReturn, createStockCountSession, enterPhysicalCount, submitStockCountSession, approveStockCountSession } from "@/lib/cartons/carton-extended.service";
import { createMixingLabReportFn, getMixingLabReportsFn } from "@/server-functions/manufacturing/mixing/lab-reports-fn";
import { getDashboardStatsFn } from "@/server-functions/dashboard/get-dashboard-fn";
import { getExpensesReportFn } from "@/server-functions/reports/expenses-report-fn";
import { getCompanyReportData } from "@/server-functions/reports/profit-loss/company-reporting-core";
import { fetchScopedSummary, fetchScopedFailedBatchLosses } from "@/server-functions/reports/profit-loss/reporting-core";

// Bypass HTTP/session transport only; handlers, validation, SQL and transactions are real.
// Middleware authorization needs its own tests; these check the handler assignment guards.
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
vi.mock("@/lib/middlewares", () => ({
  requireAuthMiddleware: {}, requireManufacturingRunManageMiddleware: {},
  requireManufacturingManageMiddleware: {}, requireProductionWorkLogMiddleware: {},
  requireProductionWorkCompleteMiddleware: {}, requireProductionWorkFailMiddleware: {},
  requireSalesViewMiddleware: {}, requireSalesManageMiddleware: {},
  requireFailedBatchRecoveryMiddleware: {},
  requireProductionWorkReadMiddleware: {},
  requireMixingLabReportReadMiddleware: {},
  requireProductionQCReadMiddleware: {},
  requireProductionQCManageMiddleware: {},
  requireDashboardViewMiddleware: {}, requireReportsViewMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

async function invoke(fn: unknown, data: unknown, actorId: string, permissions = ["manufacturing.run.manage"]) {
  const session = { user: { id: actorId, name: "Test actor" } };
  const context = { session, authContext: { session, permissions } };
  return (fn as (input: { data: unknown; context: typeof context }) => Promise<unknown>)({ data, context });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("rollback test fixture");

// Run real domain code and SQL, then roll back every fixture and stock movement.
async function withFixture(check: (tx: Tx, fixture: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("Production regressions require the isolated TEST_DATABASE_URL configuration");
  }
  try {
    await db.transaction(async tx => {
      await check(tx, await seed(tx));
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Production test", email: `${id}@test.invalid` }).returning();
  const [role] = await tx.insert(appRoles).values({ slug: id, name: "Production test operator" }).returning();
  const keys = ["operator.run.read", "operator.run.log"];
  await tx.insert(appPermissions).values(keys.map(key => ({ key, moduleKey: "operator", label: key }))).onConflictDoNothing();
  const permissions = await tx.select().from(appPermissions).where(inArray(appPermissions.key, keys));
  await tx.insert(appRolePermissions).values(permissions.map(permission => ({ roleId: role.id, permissionId: permission.id })));
  await tx.insert(userRoleAssignments).values({ userId: actor.id, roleId: role.id });
  const [warehouse] = await tx.insert(warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [chemical] = await tx.insert(chemicals).values({ name: id, costPerUnit: "10" }).returning();
  const [primary] = await tx.insert(packagingMaterials).values({ name: `${id}-bottle`, costPerUnit: "2" }).returning();
  const [master] = await tx.insert(packagingMaterials).values({ name: `${id}-carton`, type: "master", costPerUnit: "5" }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "10", batchUnit: "kg" }).returning();
  const [recipe] = await tx.insert(recipes).values({ productId: product.id, formulaId: formula.id, name: id, batchSize: "10", batchUnit: "kg", containerType: "pack", containerPackagingId: primary.id, cartonPackagingId: master.id, containersPerCarton: 4, fillAmount: "1000", fillUnit: "g" }).returning();
  const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "10", bulkUnit: "kg", status: "failed" }).returning();
  return { actor, role, warehouse, chemical, primary, master, formula, recipe, run };
}

async function cleanupCommittedFixture(f: Awaited<ReturnType<typeof seed>>) {
  await db.transaction(async tx => {
    const allocations = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.warehouseId, f.warehouse.id));
    const fixtureInvoices = await tx.select().from(invoices).where(eq(invoices.warehouseId, f.warehouse.id));
    const invoiceIds = fixtureInvoices.map(row => row.id);
    if (invoiceIds.length) {
      const records = await tx.select().from(returnRecords).where(inArray(returnRecords.dispatchOrderId, invoiceIds));
      if (records.length) await tx.delete(returnLines).where(inArray(returnLines.returnRecordId, records.map(row => row.id)));
      await tx.delete(adjustmentLog).where(inArray(adjustmentLog.dispatchOrderId, invoiceIds));
      await tx.delete(returnRecords).where(inArray(returnRecords.dispatchOrderId, invoiceIds));
      await tx.delete(salesReturns).where(inArray(salesReturns.invoiceId, invoiceIds));
      await tx.delete(slipRecords).where(inArray(slipRecords.invoiceId, invoiceIds));
      await tx.delete(priceChangeLog).where(inArray(priceChangeLog.invoiceId, invoiceIds));
      await tx.delete(invoices).where(inArray(invoices.id, invoiceIds));
      await tx.delete(customers).where(inArray(customers.id, fixtureInvoices.map(row => row.customerId)));
    }
    if (allocations.length) await tx.delete(adjustmentLog).where(inArray(adjustmentLog.packagingAllocationId, allocations.map(row => row.id)));
    await tx.delete(wacHistory).where(eq(wacHistory.warehouseId, f.warehouse.id));
    await tx.delete(cartons).where(eq(cartons.warehouseId, f.warehouse.id));
    await tx.delete(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id));
    await tx.delete(inventoryAuditLog).where(eq(inventoryAuditLog.warehouseId, f.warehouse.id));
    await tx.delete(materialStock).where(eq(materialStock.warehouseId, f.warehouse.id));
    await tx.delete(packagingAllocations).where(eq(packagingAllocations.warehouseId, f.warehouse.id));
    await tx.delete(mixingRuns).where(eq(mixingRuns.warehouseId, f.warehouse.id));
    await tx.delete(recipes).where(eq(recipes.id, f.recipe.id));
    await tx.delete(formulas).where(eq(formulas.id, f.formula.id));
    await tx.delete(packagingMaterials).where(inArray(packagingMaterials.id, [f.primary.id, f.master.id]));
    await tx.delete(chemicals).where(eq(chemicals.id, f.chemical.id));
    await tx.delete(products).where(eq(products.id, f.formula.productId));
    await tx.delete(warehouses).where(eq(warehouses.id, f.warehouse.id));
    await tx.delete(user).where(eq(user.id, f.actor.id));
    await tx.delete(appRoles).where(eq(appRoles.id, f.role.id));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Pause after the holder's actual advisory lock. The contender must block on that
// lock on another backend before either operation is allowed to finish.
async function assertAdvisorySerialization(
  lock: [string, string], first: () => Promise<unknown>, second: () => Promise<unknown>,
  forbiddenEarlierLock?: [string, string],
) {
  const originalTransaction = db.transaction.bind(db);
  const acquired = deferred<number>();
  const contender = deferred<number>();
  const release = deferred<void>();
  const dialect = new PgDialect();
  let transactionIndex = 0;
  const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
    ((callback: Parameters<typeof db.transaction>[0]) => {
      const holder = transactionIndex++ === 0;
      return originalTransaction(async tx => {
        const { rows: [backend] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        if (!holder) { contender.resolve(backend.pid); return callback(tx); }
        const instrumented = new Proxy(tx, {
          get(target, key) {
            if (key === "execute") return async (statement: Parameters<Tx["execute"]>[0]) => {
              const result = await target.execute(statement);
              const query = typeof statement === "string" ? undefined : dialect.sqlToQuery(statement.getSQL());
              if (query?.sql.includes("pg_advisory_xact_lock") && query.params.includes(lock[1]) &&
                  (query.params[0] === lock[0] || query.sql.includes(`hashtext('${lock[0]}')`))) {
                acquired.resolve(backend.pid);
                await release.promise;
              }
              return result;
            };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return callback(instrumented);
      });
    }) as typeof db.transaction,
  );
  const firstOperation = first();
  // A missing expected lock should fail immediately instead of hanging the suite.
  void firstOperation.then(() => acquired.reject(new Error("Holder finished without acquiring the expected lock")), acquired.reject);
  let secondOperation: Promise<unknown> | undefined;
  try {
    const holderPid = await acquired.promise;
    secondOperation = second();
    void secondOperation.catch(contender.reject);
    const waiterPid = await contender.promise;
    expect(waiterPid).not.toBe(holderPid);
    const deadline = Date.now() + 10_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const { rows: [observed] } = await db.execute<{ blocked: boolean; waiting: boolean }>(sql`
        SELECT ${holderPid} = ANY(pg_blocking_pids(${waiterPid})) AS blocked,
          EXISTS (SELECT 1 FROM pg_locks WHERE pid = ${waiterPid} AND locktype = 'advisory'
            AND classid = hashtext(${lock[0]})::bigint & 4294967295
            AND objid = hashtext(${lock[1]})::bigint & 4294967295 AND NOT granted) AS waiting`);
      if (observed.blocked && observed.waiting) { waiting = true; break; }
    }
    expect(waiting, "contender must actually wait on the holder's advisory lock").toBe(true);
    if (forbiddenEarlierLock) {
      const { rows: [observed] } = await db.execute<{ count: number }>(sql`
        SELECT count(*)::integer AS count FROM pg_locks WHERE pid = ${waiterPid} AND locktype = 'advisory'
          AND classid = hashtext(${forbiddenEarlierLock[0]})::bigint & 4294967295
          AND objid = hashtext(${forbiddenEarlierLock[1]})::bigint & 4294967295`);
      expect(observed.count, "order lock must precede the finished-goods lock").toBe(0);
    }
    release.resolve();
    return await Promise.allSettled([firstOperation, secondOperation]);
  } finally {
    release.resolve();
    await Promise.allSettled([firstOperation, ...(secondOperation ? [secondOperation] : [])]);
    transactionSpy.mockRestore();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("two phase production database regressions", () => {
  it("keeps formulas active while mixing is scheduled or in progress and allows terminal work deactivation", async () => {
    await withFixture(async (tx, f) => {
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        for (const status of ["scheduled", "in_progress"] as const) {
          await tx.update(mixingRuns).set({ status }).where(eq(mixingRuns.id, f.run.id));
          await expect(invoke(deleteFormulaFn, { id: f.formula.id }, f.actor.id)).rejects.toThrow("active mixing work");
          expect((await tx.query.formulas.findFirst({ where: eq(formulas.id, f.formula.id) }))?.isActive).toBe(true);
        }
        for (const status of ["completed", "failed", "cancelled"] as const) {
          await tx.update(mixingRuns).set({ status }).where(eq(mixingRuns.id, f.run.id));
          await tx.update(formulas).set({ isActive: true }).where(eq(formulas.id, f.formula.id));
          await invoke(deleteFormulaFn, { id: f.formula.id }, f.actor.id);
          expect((await tx.query.formulas.findFirst({ where: eq(formulas.id, f.formula.id) }))?.isActive).toBe(false);
        }
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("reconciles rounded mixing material costs with failed-batch recovery losses", async () => {
    await withFixture(async (tx, f) => {
      await tx.update(chemicals).set({ costPerUnit: "5" }).where(eq(chemicals.id, f.chemical.id));
      const [secondChemical] = await tx.insert(chemicals).values({ name: randomUUID(), costPerUnit: "5" }).returning();
      const chemicalIds = [f.chemical.id, secondChemical.id];
      await tx.insert(formulaIngredients).values(chemicalIds.map(chemicalId => ({
        formulaId: f.formula.id, chemicalId, quantityPerBatch: "0.001",
      })));
      await tx.insert(materialStock).values(chemicalIds.map(chemicalId => ({
        warehouseId: f.warehouse.id, chemicalId, quantity: "0.001",
      })));
      await tx.update(mixingRuns).set({ status: "scheduled" }).where(eq(mixingRuns.id, f.run.id));
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await invoke(startMixingRunFn, { mixingRunId: f.run.id }, f.actor.id);
        const usage = await tx.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, f.run.id));
        expect(usage.map(row => row.totalCost)).toEqual(["0.01", "0.01"]);
        const [recorded] = await tx.select({ total: sql<string>`sum(${mixingMaterialsUsed.totalCost})` })
          .from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, f.run.id));
        const run = await tx.query.mixingRuns.findFirst({ where: eq(mixingRuns.id, f.run.id) });
        expect(Number(recorded.total)).toBe(0.02);
        expect.soft(Number(run?.totalChemicalCost)).toBe(Number(recorded.total));

        await invoke(failMixingRunFn, { id: f.run.id, reason: "No recoverable output" }, f.actor.id);
        for (const chemicalId of chemicalIds) {
          const recovery = await invoke(recoverFailedProductionChemicalFn, {
            batchId: f.run.batchId, chemicalId, recoveredQuantity: 0, reason: "Measured complete loss",
          }, f.actor.id) as { lossQuantity: number; lossAmount: number };
          expect(recovery.lossQuantity).toBe(0.001);
          expect(recovery.lossAmount).toBe(0.01);
        }
        const [settled] = await tx.select({ loss: sql<string>`sum(${failedProductionChemicalRecoveries.lossAmount})` })
          .from(failedProductionChemicalRecoveries).where(eq(failedProductionChemicalRecoveries.mixingRunId, f.run.id));
        expect(Number(settled.loss)).toBe(Number(recorded.total));
        expect.soft(Number(settled.loss)).toBe(Number(run?.totalChemicalCost));
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("reconciles rounded packaging material costs with allocation totals and finished stock value", async () => {
    await withFixture(async (tx, f) => {
      await tx.update(recipes).set({ cartonPackagingId: null, containersPerCarton: 0 })
        .where(eq(recipes.id, f.recipe.id));
      await tx.update(packagingMaterials).set({ costPerUnit: "0" }).where(eq(packagingMaterials.id, f.primary.id));
      const [secondMaterial] = await tx.insert(packagingMaterials).values({ name: randomUUID(), costPerUnit: "5" }).returning();
      const [repeatedMaterial] = await tx.insert(packagingMaterials).values({ name: randomUUID(), costPerUnit: "0.50" }).returning();
      const materialIds = [f.master.id, secondMaterial.id];
      await tx.update(packagingMaterials).set({ costPerUnit: "5" }).where(inArray(packagingMaterials.id, materialIds));
      await tx.insert(recipePackaging).values(materialIds.map(packagingMaterialId => ({
        recipeId: f.recipe.id, packagingMaterialId, quantityPerContainer: "0.001", usageBasis: "per_unit",
      })));
      await tx.insert(recipePackaging).values(["0.001", "0.009"].map(quantityPerContainer => ({
        recipeId: f.recipe.id, packagingMaterialId: repeatedMaterial.id, quantityPerContainer, usageBasis: "per_unit",
      })));
      await tx.insert(materialStock).values([
        { warehouseId: f.warehouse.id, packagingMaterialId: f.primary.id, quantity: "1" },
        { warehouseId: f.warehouse.id, packagingMaterialId: repeatedMaterial.id, quantity: "0.010" },
        ...materialIds.map(packagingMaterialId => ({ warehouseId: f.warehouse.id, packagingMaterialId, quantity: "0.001" })),
      ]);
      const [allocation] = await tx.insert(packagingAllocations).values({
        mixingRunId: f.run.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
        allocatedBulkQuantity: "1", allocatedBulkUnit: "kg", allocatedChemicalCost: "0.03",
        targetContainers: 1, status: "in_progress",
      }).returning();
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await invoke(logPackagingProgressFn, { allocationId: allocation.id, containersProduced: 1 }, f.actor.id);
        const usage = await tx.select().from(packagingMaterialsUsed)
          .where(eq(packagingMaterialsUsed.packagingAllocationId, allocation.id));
        expect(usage.filter(row => materialIds.includes(row.materialId)).map(row => row.totalCost)).toEqual(["0.01", "0.01"]);
        expect(usage.find(row => row.materialId === repeatedMaterial.id)).toMatchObject({ quantityUsed: "0.010", totalCost: "0.01" });
        const [recorded] = await tx.select({ total: sql<string>`sum(${packagingMaterialsUsed.totalCost})` })
          .from(packagingMaterialsUsed).where(eq(packagingMaterialsUsed.packagingAllocationId, allocation.id));
        const packed = await tx.query.packagingAllocations.findFirst({ where: eq(packagingAllocations.id, allocation.id) });
        expect(Number(recorded.total)).toBe(0.03);
        expect(packed?.status).toBe("completed");
        expect.soft(Number(packed?.totalPackagingCost)).toBe(Number(recorded.total));
        expect.soft(Number(packed?.totalProductionCost)).toBe(0.06);
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(stock.quantityContainers).toBe(1);
        expect.soft(Number(stock.weightedAverageCostPerPack)).toBe(0.06);
        expect.soft(Number(stock.totalInventoryValue)).toBe(0.06);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("preserves standard full cartons when loose units and cartons share an invoice", async () => {
    await withFixture(async (tx, f) => {
      async function receipt(units: number) {
        const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.recipe.id,
          warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: String(units), allocatedBulkUnit: "kg",
          allocatedChemicalCost: String(units * 13), targetContainers: units, completedContainers: units, status: "in_progress" }).returning();
        await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
        return tx.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
      }
      await receipt(4);
      const rows = await receipt(6);
      const nonstandard = rows.find(carton => carton.currentPacks === 4)!;
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await repackCarton(nonstandard.id, 6, "Use a larger temporary box", f.actor.id);
        await topUpCarton(nonstandard.id, 2, f.actor.id);
        await postInvoice(tx, {
          ...createInvoiceSchema.parse({ customerName: "Mixed units and cartons", warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"),
            items: [{ recipeId: f.recipe.id, pack: f.recipe.name, unitType: "units", numberOfUnits: 3, packsPerCarton: 4, perCartonPrice: 80, retailPrice: 20, isPriceOverride: true },
              { recipeId: f.recipe.id, pack: f.recipe.name, unitType: "carton", numberOfCartons: 1, packsPerCarton: 4, perCartonPrice: 80, retailPrice: 20, isPriceOverride: true }] }),
          performedById: f.actor.id, source: "online", businessDate: new Date(), stockPolicy: "strict", creditPolicy: "block", pricingPolicy: "live",
        });
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        const cartonsLeft = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
        expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(5);
        expect(cartonsLeft.reduce((sum, carton) => sum + carton.currentPacks, 0)).toBe(5);
        expect(Number(stock.totalInventoryValue)).toBe(65);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("settles decimal chemical quantities without a false over-recovery error", async () => {
    await withFixture(async (tx, f) => {
      await tx.insert(mixingMaterialsUsed).values([
        { mixingRunId: f.run.id, chemicalId: f.chemical.id, quantityUsed: "0.3", costPerUnit: "10", totalCost: "3" },
        { mixingRunId: f.run.id, chemicalId: f.chemical.id, quantityUsed: "0.6", costPerUnit: "10", totalCost: "6" },
      ]);
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        const result = await invoke(recoverFailedProductionChemicalFn, { batchId: f.run.batchId,
          chemicalId: f.chemical.id, recoveredQuantity: 0.9, reason: "Full measured recovery" }, f.actor.id) as { expectedQuantity: number; lossQuantity: number };
        expect(result.expectedQuantity).toBe(0.9);
        expect(result.lossQuantity).toBe(0);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("assigns only operators with work permissions and honors active bans", async () => {
    await withFixture(async (tx, f) => {
      expect(await getProductionOperators(tx, f.actor.id)).toEqual([{ id: f.actor.id, name: f.actor.name }]);
      await tx.update(user).set({ banned: true, banExpires: new Date("2099-01-01") }).where(eq(user.id, f.actor.id));
      expect(await getProductionOperators(tx, f.actor.id)).toEqual([]);
      await tx.update(user).set({ banned: true, banExpires: new Date("2000-01-01") }).where(eq(user.id, f.actor.id));
      expect(await getProductionOperators(tx, f.actor.id)).toHaveLength(1);
      await tx.delete(appRolePermissions).where(eq(appRolePermissions.roleId, f.role.id));
      expect(await getProductionOperators(tx, f.actor.id)).toEqual([]);
      await tx.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, f.actor.id));
      expect(await getProductionOperators(tx, f.actor.id)).toEqual([]);
    });
  });

  it("serializes competing bulk allocations, chemical debits and batch numbers across connections", async () => {
    if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Isolated audit database required");
    // These fixtures must be committed so independent connections can see them.
    // Cleanup is restricted to this fixture's warehouse, recipe, formula and actor.
    const f = await db.transaction(seed);
    try {
      await db.update(mixingRuns).set({ status: "completed", actualBulkProduced: "10", totalChemicalCost: "100" }).where(eq(mixingRuns.id, f.run.id));
      const request = { mixingRunId: f.run.id, recipeId: f.recipe.id, allocatedBulkQuantity: 6, operatorId: f.actor.id };
      const allocations = await Promise.allSettled([
        invoke(createPackagingAllocationFn, request, f.actor.id), invoke(createPackagingAllocationFn, request, f.actor.id),
      ]);
      expect(allocations.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(allocations.filter(result => result.status === "rejected")).toHaveLength(1);
      const reserved = await db.select().from(packagingAllocations).where(eq(packagingAllocations.warehouseId, f.warehouse.id));
      expect(reserved.reduce((sum, row) => sum + Number(row.allocatedBulkQuantity), 0)).toBe(6);
      const second = await invoke(createPackagingAllocationFn, { ...request, allocatedBulkQuantity: 2 }, f.actor.id) as { allocation: { id: string } };
      await db.update(packagingAllocations).set({ status: "in_progress", completedContainers: 4 }).where(eq(packagingAllocations.id, reserved[0].id));
      await db.update(packagingAllocations).set({ status: "in_progress", completedContainers: 2 }).where(eq(packagingAllocations.id, second.allocation.id));
      await Promise.all([
        db.transaction(tx => completePackagingAllocationCore(tx, reserved[0].id, f.actor.id, "Measured shortfall")),
        db.transaction(tx => completePackagingAllocationCore(tx, second.allocation.id, f.actor.id)),
      ]);
      const [received] = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id));
      expect(received.quantityCartons * 4 + received.quantityContainers).toBe(6);
      expect(Number(received.totalInventoryValue)).toBe(80);
      const [full] = await db.select().from(cartons).where(eq(cartons.packagingAllocationId, reserved[0].id));
      await Promise.all([
        closeBatch(reserved[0].id, f.actor.id),
        executeBulkOperation("REMOVE", [full.id], { delta: 1 }, f.actor.id),
      ]);
      const [adjusted] = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id));
      expect(adjusted.quantityCartons * 4 + adjusted.quantityContainers).toBe(5);
      expect(Number(adjusted.totalInventoryValue)).toBe(66.67);

      await db.insert(formulaIngredients).values({ formulaId: f.formula.id, chemicalId: f.chemical.id, quantityPerBatch: "10" });
      await db.insert(materialStock).values({ warehouseId: f.warehouse.id, chemicalId: f.chemical.id, quantity: "10" });
      const creates = await Promise.all([
        invoke(createMixingRunFn, { formulaId: f.formula.id, warehouseId: f.warehouse.id, operatorId: f.actor.id }, f.actor.id),
        invoke(createMixingRunFn, { formulaId: f.formula.id, warehouseId: f.warehouse.id, operatorId: f.actor.id }, f.actor.id),
      ]) as Array<{ mixingRun: { id: string; batchId: string } }>;
      expect(new Set(creates.map(result => result.mixingRun.batchId)).size).toBe(2);
      const numbers = creates.map(result => Number(result.mixingRun.batchId.slice(1))).sort((a, b) => a - b);
      expect(numbers[1] - numbers[0]).toBe(1);
      const starts = await Promise.allSettled(creates.map(result => invoke(startMixingRunFn, { mixingRunId: result.mixingRun.id }, f.actor.id)));
      expect(starts.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(starts.filter(result => result.status === "rejected")).toHaveLength(1);
      const [stock] = await db.select().from(materialStock).where(eq(materialStock.warehouseId, f.warehouse.id));
      expect(Number(stock.quantity)).toBe(0);
      const usage = await db.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.chemicalId, f.chemical.id));
      expect(usage.reduce((sum, row) => sum + Number(row.quantityUsed), 0)).toBe(10);
    } finally {
      await db.transaction(async tx => {
        const allocationIds = (await tx.select().from(packagingAllocations).where(eq(packagingAllocations.warehouseId, f.warehouse.id))).map(row => row.id);
        if (allocationIds.length) await tx.delete(adjustmentLog).where(inArray(adjustmentLog.packagingAllocationId, allocationIds));
        await tx.delete(wacHistory).where(eq(wacHistory.warehouseId, f.warehouse.id));
        await tx.delete(cartons).where(eq(cartons.warehouseId, f.warehouse.id));
        await tx.delete(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id));
        await tx.delete(inventoryAuditLog).where(eq(inventoryAuditLog.warehouseId, f.warehouse.id));
        await tx.delete(materialStock).where(eq(materialStock.warehouseId, f.warehouse.id));
        await tx.delete(packagingAllocations).where(eq(packagingAllocations.warehouseId, f.warehouse.id));
        await tx.delete(mixingRuns).where(eq(mixingRuns.warehouseId, f.warehouse.id));
        await tx.delete(recipes).where(eq(recipes.id, f.recipe.id));
        await tx.delete(formulas).where(eq(formulas.id, f.formula.id));
        await tx.delete(packagingMaterials).where(inArray(packagingMaterials.id, [f.primary.id, f.master.id]));
        await tx.delete(chemicals).where(eq(chemicals.id, f.chemical.id));
        await tx.delete(products).where(eq(products.id, f.formula.productId));
        await tx.delete(warehouses).where(eq(warehouses.id, f.warehouse.id));
        await tx.delete(user).where(eq(user.id, f.actor.id));
        await tx.delete(appRoles).where(eq(appRoles.id, f.role.id));
      });
    }
  });

  it("makes invoice dispatch win before a waiting bulk removal reads carton quantities on a separate connection", async () => {
    if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Isolated audit database required");
    const f = await db.transaction(seed);
    try {
      const [allocation] = await db.insert(packagingAllocations).values({
        mixingRunId: f.run.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
        allocatedBulkQuantity: "4", allocatedBulkUnit: "kg", allocatedChemicalCost: "40", totalPackagingCost: "12",
        targetContainers: 4, completedContainers: 4, status: "in_progress",
      }).returning();
      await db.transaction(tx => completePackagingAllocationCore(tx, allocation.id, f.actor.id));
      const [carton] = await db.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
      const request = {
        ...createInvoiceSchema.parse({ customerName: randomUUID(), warehouseId: f.warehouse.id,
          paymentDueDate: new Date("2099-01-01"), items: [{ recipeId: f.recipe.id, pack: f.recipe.name,
            unitType: "units", numberOfUnits: 3, packsPerCarton: 4, perCartonPrice: 80, retailPrice: 20, isPriceOverride: true }] }),
        // Bind this concurrency test to its own warehouse, not the first global factory floor.
        performedById: f.actor.id, source: "offline_import" as const, publicInvoiceNumber: randomUUID(), businessDate: new Date(),
        stockPolicy: "strict" as const, creditPolicy: "block" as const, pricingPolicy: "live" as const,
      };
      const [invoiceResult, bulkResult] = await assertAdvisorySerialization(
        [f.warehouse.id, f.recipe.id], () => db.transaction(tx => postInvoice(tx, request)),
        () => executeBulkOperation("REMOVE", [carton.id], { delta: 2 }, f.actor.id),
      );
      expect(invoiceResult.status).toBe("fulfilled");
      expect(bulkResult.status).toBe("rejected");
      if (bulkResult.status === "rejected") expect(bulkResult.reason.message).toContain("Current count is only 1");
      const [stock] = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
      const [after] = await db.select().from(cartons).where(eq(cartons.id, carton.id));
      const ledger = await db.select().from(adjustmentLog).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
      expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(1);
      expect(after.currentPacks).toBe(1);
      expect(Number(stock.totalInventoryValue)).toBe(13);
      expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(1);
      expect(ledger.filter(row => row.type === "REMOVAL")).toEqual([]);
      expect(ledger.find(row => row.type === "DISPATCH_PARTIAL")).toMatchObject({
        packagingAllocationId: allocation.id, batchId: null, delta: -3, packsBefore: 4, packsAfter: 1,
      });
    } finally {
      await cleanupCommittedFixture(f);
    }
  });

  it("makes manual dispatch and return approval wait on their shared order before finished stock on separate connections", async () => {
    if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Isolated audit database required");
    const f = await db.transaction(seed);
    try {
      const [allocation] = await db.insert(packagingAllocations).values({
        mixingRunId: f.run.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
        allocatedBulkQuantity: "4", allocatedBulkUnit: "kg", allocatedChemicalCost: "40", totalPackagingCost: "12",
        targetContainers: 4, completedContainers: 4, status: "in_progress",
      }).returning();
      await db.transaction(tx => completePackagingAllocationCore(tx, allocation.id, f.actor.id));
      const invoice = await db.transaction(tx => postInvoice(tx, {
        ...createInvoiceSchema.parse({ customerName: randomUUID(), warehouseId: f.warehouse.id,
          paymentDueDate: new Date("2099-01-01"), items: [{ recipeId: f.recipe.id, pack: f.recipe.name,
            unitType: "units", numberOfUnits: 1, packsPerCarton: 4, perCartonPrice: 80, retailPrice: 20, isPriceOverride: true }] }),
        // Bind this concurrency test to its own warehouse, not the first global factory floor.
        performedById: f.actor.id, source: "offline_import", publicInvoiceNumber: randomUUID(), businessDate: new Date(),
        stockPolicy: "strict", creditPolicy: "block", pricingPolicy: "live",
      }));
      const item = await db.query.invoiceItems.findFirst({ where: (item, { eq }) => eq(item.invoiceId, invoice.id) });
      const returned = await invoke(createSalesReturnFn, { invoiceId: invoice.id, reason: "Good returned pack", condition: "good",
        items: [{ invoiceItemId: item!.id, quantityReturned: 1, refundPerUnit: 20 }] }, f.actor.id) as { id: string };
      const [carton] = await db.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
      const operations = await assertAdvisorySerialization(
        ["carton_return", invoice.id], () => dispatchCartons([{ cartonId: carton.id, packsToDispatch: 1 }], invoice.id, f.actor.id),
        () => invoke(processSalesReturnFn, { returnId: returned.id, action: "approve" }, f.actor.id),
        [f.warehouse.id, f.recipe.id],
      );
      expect(operations.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
      const [stock] = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
      const current = await db.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      const ledger = await db.select().from(adjustmentLog).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
      expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(3);
      expect(current.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(3);
      expect(Number(stock.totalInventoryValue)).toBe(39);
      expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(3);
      expect(ledger.filter(row => row.type === "DISPATCH_PARTIAL").map(row => row.delta)).toEqual([-1, -1]);
      expect(ledger.find(row => row.type === "RETURN_GOOD")).toMatchObject({
        dispatchOrderId: invoice.id, packagingAllocationId: allocation.id, batchId: null, delta: 1,
      });
      expect((await db.query.salesReturns.findFirst({ where: eq(salesReturns.id, returned.id) }))?.status).toBe("approved");
    } finally {
      await cleanupCommittedFixture(f);
    }
  });

  it("attaches QC reports to mixing with the product snapshot and assigned-reader guard", async () => {
    await withFixture(async (tx, f) => {
      // Route direct db calls into the rollback transaction; actual relation queries and inserts run.
      const mixingQuery = vi.spyOn(db.query.mixingRuns, "findFirst").mockImplementation(tx.query.mixingRuns.findFirst.bind(tx.query.mixingRuns));
      const reportQuery = vi.spyOn(db.query.productionRunLabReports, "findMany").mockImplementation(tx.query.productionRunLabReports.findMany.bind(tx.query.productionRunLabReports));
      const insertSpy = vi.spyOn(db, "insert").mockImplementation(tx.insert.bind(tx));
      try {
        const report = await invoke(createMixingLabReportFn, { mixingRunId: f.run.id,
          analysisItems: [{ item: "Density", requirement: "Within range", result: "Pass", passed: true }],
          certifiedBy: "QA", reportDate: "2026-10-01" }, f.actor.id) as { id: string; mixingRunId: string; productionRunId: string | null; productName: string; lotNumber: string };
        expect(report.mixingRunId).toBe(f.run.id);
        expect(report.productionRunId).toBeNull();
        expect(report.productName).toBe(f.formula.name);
        expect(report.lotNumber).toBe(f.run.batchId);
        await tx.update(products).set({ name: "Renamed after certification" }).where(eq(products.id, f.formula.productId));
        const run = await tx.query.mixingRuns.findFirst({ where: eq(mixingRuns.id, f.run.id), with: { labReports: true } });
        expect(run?.labReports.map(report => report.id)).toEqual([report.id]);
        const listed = await invoke(getMixingLabReportsFn, { mixingRunId: f.run.id }, f.actor.id, ["operator.run.read"]) as Array<{ id: string; createdBy: { id: string } }>;
        expect(listed.map(report => report.id)).toEqual([report.id]);
        expect(listed[0].createdBy.id).toBe(f.actor.id);
        expect(listed[0]).toMatchObject({ productName: report.productName, lotNumber: f.run.batchId });
        await expect(invoke(getMixingLabReportsFn, { mixingRunId: f.run.id }, "another-user", ["operator.run.read"])).rejects.toThrow("another operator");
      } finally {
        insertSpy.mockRestore(); reportQuery.mockRestore(); mixingQuery.mockRestore();
      }
    });
  });

  it("queries dashboard, expenses and profit/loss with distinct mixing, packaging and recovery date boundaries", async () => {
    await withFixture(async (tx, f) => {
      const mixedAt = new Date("2091-01-10T12:00:00Z");
      const reportedAt = new Date("2091-01-20T12:00:00Z");
      const outsideAt = new Date("2091-01-21T12:00:00Z");
      const [mixed] = await tx.insert(mixingRuns).values({
        batchId: randomUUID(), formulaId: f.formula.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
        targetBulkQuantity: "10", actualBulkProduced: "10", totalChemicalCost: "100", bulkUnit: "kg",
        status: "completed", actualCompletionDate: mixedAt, createdAt: new Date("2091-01-09T12:00:00Z"), updatedAt: mixedAt,
      }).returning();
      await tx.insert(mixingMaterialsUsed).values([
        { mixingRunId: mixed.id, chemicalId: f.chemical.id, quantityUsed: "10", costPerUnit: "10", totalCost: "100" },
        { mixingRunId: f.run.id, chemicalId: f.chemical.id, quantityUsed: "5", costPerUnit: "16", totalCost: "80" },
      ]);
      const [included, excluded] = await tx.insert(packagingAllocations).values([
        { mixingRunId: mixed.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
          allocatedBulkQuantity: "6", allocatedBulkUnit: "kg", allocatedChemicalCost: "60", totalPackagingCost: "18",
          targetContainers: 6, completedContainers: 6, targetCartons: 1, status: "in_progress" as const, createdAt: new Date("2091-01-19T12:00:00Z") },
        { mixingRunId: mixed.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
          allocatedBulkQuantity: "4", allocatedBulkUnit: "kg", allocatedChemicalCost: "40", totalPackagingCost: "12",
          targetContainers: 4, completedContainers: 4, targetCartons: 1, status: "in_progress" as const, createdAt: outsideAt },
      ]).returning();
      await completePackagingAllocationCore(tx, included.id, f.actor.id);
      await completePackagingAllocationCore(tx, excluded.id, f.actor.id);
      await tx.update(packagingAllocations).set({ completedAt: reportedAt, updatedAt: reportedAt }).where(eq(packagingAllocations.id, included.id));
      await tx.update(packagingAllocations).set({ completedAt: outsideAt, updatedAt: outsideAt }).where(eq(packagingAllocations.id, excluded.id));

      // These readers use the global db object; point its real SQL builders at the rollback transaction.
      const spies = [
        vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx)),
        vi.spyOn(db, "transaction").mockImplementation(
          ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
        ),
        vi.spyOn(db.query.payrolls, "findMany").mockImplementation(tx.query.payrolls.findMany.bind(tx.query.payrolls)),
        vi.spyOn(db.query.mixingRuns, "findMany").mockImplementation(tx.query.mixingRuns.findMany.bind(tx.query.mixingRuns)),
        vi.spyOn(db.query.packagingAllocations, "findMany").mockImplementation(tx.query.packagingAllocations.findMany.bind(tx.query.packagingAllocations)),
        vi.spyOn(db.query.expenses, "findMany").mockImplementation(tx.query.expenses.findMany.bind(tx.query.expenses)),
        vi.spyOn(db.query.orderBookers, "findMany").mockImplementation(tx.query.orderBookers.findMany.bind(tx.query.orderBookers)),
      ];
      try {
        const recovery = await invoke(recoverFailedProductionChemicalFn, { batchId: f.run.batchId,
          chemicalId: f.chemical.id, recoveredQuantity: 3, reason: "Measured spill" }, f.actor.id) as { lossAmount: number };
        expect(recovery.lossAmount).toBe(32);
        await tx.update(failedProductionChemicalRecoveries).set({ createdAt: reportedAt })
          .where(eq(failedProductionChemicalRecoveries.mixingRunId, f.run.id));
        const settlement = await tx.query.failedProductionChemicalRecoveries.findFirst({
          where: eq(failedProductionChemicalRecoveries.mixingRunId, f.run.id),
          with: { mixingRun: true, productionRun: true, chemical: true },
        });
        expect(settlement).toMatchObject({ mixingRunId: f.run.id, productionRunId: null,
          lossQuantity: "2.000", lossAmount: "32.00", mixingRun: { batchId: f.run.batchId }, productionRun: null,
          chemical: { id: f.chemical.id } });

        const day = { dateFrom: "2091-01-20", dateTo: "2091-01-20" };
        const dashboard = await invoke(getDashboardStatsFn, { startDate: "2091-01-20T00:00:00Z", endDate: "2091-01-20T23:59:59.999Z" }, f.actor.id) as Awaited<ReturnType<typeof getDashboardStatsFn>>;
        expect(dashboard.materialConsumptionCost).toBe(18);
        expect.soft(dashboard.totalCartonsProduced).toBe(1);
        expect(dashboard.activeProductionRuns).toBe(0);
        expect.soft(dashboard.completedProductionRuns).toBe(1);
        expect.soft(dashboard.invoiceCount).toBe(0);
        expect.soft(typeof dashboard.activeEmployees).toBe("number");
        expect(dashboard.revenueExpenseChart).toMatchObject([{ expenses: 18 }]);
        expect(dashboard.recentActivity.find(row => row.id === included.id)).toMatchObject({
          batchId: mixed.batchId, recipeName: f.recipe.name, cartonsProduced: 1, containersProduced: 6, totalProductionCost: 78,
        });
        const mixingDay = await invoke(getDashboardStatsFn, { startDate: "2091-01-10T00:00:00Z", endDate: "2091-01-10T23:59:59.999Z" }, f.actor.id) as Awaited<ReturnType<typeof getDashboardStatsFn>>;
        expect(mixingDay.materialConsumptionCost).toBe(100);
        expect(mixingDay.totalCartonsProduced).toBe(0);
        expect.soft(mixingDay.completedProductionRuns).toBe(1);
        for (const date of ["2091-01-09", "2091-01-19"]) {
          const creationDay = await invoke(getDashboardStatsFn, { startDate: `${date}T00:00:00Z`, endDate: `${date}T23:59:59.999Z` }, f.actor.id) as Awaited<ReturnType<typeof getDashboardStatsFn>>;
          expect.soft(creationDay.completedProductionRuns).toBe(0);
          expect.soft(creationDay.totalCartonsProduced).toBe(0);
        }

        const expenses = await invoke(getExpensesReportFn, day, f.actor.id) as Awaited<ReturnType<typeof getExpensesReportFn>>;
        expect(expenses.productionCosts.map(row => row.runId)).toEqual([included.id]);
        expect(expenses.productionCosts[0]).toMatchObject({ batchId: mixed.batchId, recipeName: f.recipe.name,
          totalChemicalCost: 60, totalPackagingCost: 18, totalProductionCost: 78, actualCostPerPack: 13 });
        expect(expenses.failedBatchLosses).toMatchObject([{ settlementId: settlement!.id, batchId: f.run.batchId,
          recipeName: f.formula.name, expectedQuantity: 5, recoveredQuantity: 3, lossQuantity: 2, lossAmount: 32 }]);
        expect(expenses.summary).toMatchObject({ totalProductionCosts: 78, totalFailedBatchLosses: 32, grandTotal: 110 });
        const company = await getCompanyReportData(day);
        expect(company.summary).toMatchObject({ totalCogs: 0, generalExpenses: 32, totalOperatingExpenses: 32, netProfit: -32 });
        expect(company.reconciliation.periodNetMovement).toBe(0);
        expect(company.reconciliation.bridgeRows.find(row => row.type === "failed_batch_losses")?.amount).toBe(32);
        const range = { fromDate: new Date("2091-01-20T00:00:00Z"), toDate: new Date("2091-01-20T23:59:59.999Z") };
        expect(await fetchScopedSummary({ ...range, productId: f.formula.productId })).toMatchObject({ failedBatchLosses: 32, grossProfit: 0, netImpact: -32 });
        expect(await fetchScopedSummary({ ...range, recipeId: f.recipe.id })).toMatchObject({ failedBatchLosses: 0 });
        expect(await fetchScopedFailedBatchLosses({ productId: f.formula.productId }, range)).toMatchObject([{
          mixingRunId: f.run.id, productionRunId: null, recipeId: null, productId: f.formula.productId,
          chemicalId: f.chemical.id, lossAmount: 32,
        }]);
        const outside = await invoke(getExpensesReportFn, { dateFrom: "2091-01-21", dateTo: "2091-01-21" }, f.actor.id) as Awaited<ReturnType<typeof getExpensesReportFn>>;
        expect(outside.productionCosts.map(row => row.runId)).toEqual([excluded.id]);
        expect(outside.summary.totalFailedBatchLosses).toBe(0);
        expect((await getCompanyReportData({ dateFrom: "2091-01-21", dateTo: "2091-01-21" })).summary.generalExpenses).toBe(0);
      } finally {
        for (const spy of spies.reverse()) spy.mockRestore();
      }
    });
  });

  it("enforces manual return source limits and reconciles zero and stale physical counts", async () => {
    await withFixture(async (tx, f) => {
      const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.recipe.id,
        warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: "6", allocatedBulkUnit: "kg",
        allocatedChemicalCost: "60", totalPackagingCost: "18", targetContainers: 6, completedContainers: 6,
        targetCartons: 1, status: "in_progress" }).returning();
      await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
      const rows = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      const full = rows.find(row => row.status === "COMPLETE")!;
      const partial = rows.find(row => row.status === "PARTIAL")!;
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        const [customer] = await tx.insert(customers).values({ name: randomUUID() }).returning();
        const [orderInvoice, wrongInvoice] = await tx.insert(invoices).values([0, 1].map(() => ({
          customerId: customer.id, invoiceNumber: randomUUID(), warehouseId: f.warehouse.id, performedById: f.actor.id,
        }))).returning();
        const order = orderInvoice.id;
        await dispatchCartons([{ cartonId: full.id, packsToDispatch: 4 }, { cartonId: partial.id, packsToDispatch: 1 }], order, f.actor.id);
        await expect(processReturn(wrongInvoice.id, [{ cartonId: full.id, packsReturned: 1, condition: "GOOD" }], undefined, f.actor.id)).rejects.toThrow("remaining dispatch");
        await expect(processReturn(order, [{ cartonId: full.id, packsReturned: 40, condition: "GOOD" }], undefined, f.actor.id)).rejects.toThrow("remaining dispatch");
        await processReturn(order, [{ cartonId: full.id, packsReturned: 2, condition: "GOOD" }], undefined, f.actor.id);
        await processReturn(order, [{ cartonId: full.id, packsReturned: 2, condition: "DAMAGED" }], undefined, f.actor.id);
        await expect(processReturn(order, [{ cartonId: full.id, packsReturned: 1, condition: "DAMAGED" }], undefined, f.actor.id)).rejects.toThrow("remaining dispatch");
        await processReturn(order, [{ cartonId: partial.id, packsReturned: 1, condition: "GOOD", destinationCartonId: full.id }], undefined, f.actor.id);
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(4);
        expect(Number(stock.totalInventoryValue)).toBe(52);
        const session = await createStockCountSession(allocation.id, undefined, f.actor.id);
        const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.sessionId, session.id));
        for (const line of lines) await enterPhysicalCount(line.id, line.cartonId === full.id ? 0 : line.systemCount);
        await submitStockCountSession(session.id);
        const decisions = lines.map(line => ({ lineId: line.id, approved: true }));
        await approveStockCountSession(session.id, decisions, f.actor.id);
        await expect(approveStockCountSession(session.id, decisions, f.actor.id)).rejects.toThrow("not pending approval");
        const [counted] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(counted.quantityCartons * 4 + counted.quantityContainers).toBe(1);
        expect(Number(counted.totalInventoryValue)).toBe(13);

        const stale = await createStockCountSession(allocation.id, undefined, f.actor.id);
        const staleLines = await tx.select().from(stockCountLines).where(eq(stockCountLines.sessionId, stale.id));
        for (const line of staleLines) await enterPhysicalCount(line.id, line.systemCount);
        await submitStockCountSession(stale.id);
        await topUpCarton(partial.id, 1, f.actor.id);
        await expect(approveStockCountSession(stale.id, staleLines.map(line => ({ lineId: line.id, approved: true })), f.actor.id)).rejects.toThrow("changed during the count");
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("moves stock between warehouses at source WAC and merges cartons without changing value", async () => {
    await withFixture(async (tx, f) => {
      const [destinationWarehouse] = await tx.insert(warehouses).values({ name: randomUUID(), address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
      async function receipt(warehouseId: string, units: number, cost: number) {
        const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.recipe.id,
          warehouseId, operatorId: f.actor.id, allocatedBulkQuantity: String(units), allocatedBulkUnit: "kg",
          allocatedChemicalCost: String(cost), targetContainers: units, completedContainers: units, status: "in_progress" }).returning();
        await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
        return tx.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
      }
      const source = await receipt(f.warehouse.id, 6, 78);
      const [destination] = await receipt(destinationWarehouse.id, 2, 40);
      const full = source.find(carton => carton.currentPacks === 4)!;
      const partial = source.find(carton => carton.currentPacks === 2)!;
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await transferPacks(full.id, destination.id, 2, f.actor.id);
        const stocks = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        const origin = stocks.find(stock => stock.warehouseId === f.warehouse.id)!;
        const inbound = stocks.find(stock => stock.warehouseId === destinationWarehouse.id)!;
        expect(origin.quantityCartons * 4 + origin.quantityContainers).toBe(4);
        expect(Number(origin.totalInventoryValue)).toBe(52);
        expect(inbound.quantityCartons * 4 + inbound.quantityContainers).toBe(4);
        expect(Number(inbound.totalInventoryValue)).toBe(66);
        expect(Number(inbound.weightedAverageCostPerPack)).toBe(16.5);
        await mergeCartons([full.id], partial.id, f.actor.id);
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.warehouseId, f.warehouse.id));
        expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(4);
        expect(Number(stock.totalInventoryValue)).toBe(52);
        await expect(mergeCartons([partial.id], partial.id, f.actor.id)).rejects.toThrow("different from the destination");
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("keeps carton adjustments, QC losses and transfers aligned with finished goods value", async () => {
    await withFixture(async (tx, f) => {
      const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.recipe.id,
        warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: "6", allocatedBulkUnit: "kg",
        allocatedChemicalCost: "60", totalPackagingCost: "18", targetContainers: 6, completedContainers: 6,
        targetCartons: 1, status: "in_progress" }).returning();
      await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
      const rows = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      const partial = rows.find(row => row.status === "PARTIAL")!;
      const full = rows.find(row => row.status === "COMPLETE")!;
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      async function assertStock(units: number, value: number) {
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        const current = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
        expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(units);
        expect(current.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(units);
        expect(Number(stock.totalInventoryValue)).toBe(value);
      }
      try {
        const closed = await closeBatch(allocation.id, f.actor.id);
        expect(closed.cartonsSealed).toBe(1);
        const reopened = await reopenBatch(allocation.id, f.actor.id, "Inspect received cartons");
        expect(reopened.productionRun?.status).toBe("completed");
        await expect(completePackagingAllocationCore(tx, allocation.id, f.actor.id)).rejects.toThrow("in progress");
        await expect(addCartonsToBatch(allocation.id, 1, f.actor.id)).rejects.toThrow("exceed");
        await applyQcHold(full.id, "Count while held", f.actor.id);
        const heldSession = await createStockCountSession(allocation.id, undefined, f.actor.id);
        const heldLines = await tx.select().from(stockCountLines).where(eq(stockCountLines.sessionId, heldSession.id));
        for (const line of heldLines) await enterPhysicalCount(line.id, line.cartonId === full.id ? 2 : line.systemCount);
        await submitStockCountSession(heldSession.id);
        await approveStockCountSession(heldSession.id, heldLines.map(line => ({ lineId: line.id, approved: true })), f.actor.id);
        const cleared = await releaseQcHold(full.id, "CLEARED", undefined, f.actor.id, true);
        expect(cleared.carton.status).toBe("PARTIAL");
        expect(cleared.carton.currentPacks).toBe(2);
        await setCartonCount(full.id, 4, f.actor.id, "Correct recount restores full carton");
        await topUpCarton(partial.id, 1, f.actor.id);
        await assertStock(7, 91);
        await removePacksFromCarton(full.id, 1, f.actor.id, "DAMAGED");
        await assertStock(6, 78);
        await setCartonCount(partial.id, 2, f.actor.id, "Correct counted quantity");
        await assertStock(5, 65);
        await transferPacks(full.id, partial.id, 1, f.actor.id);
        await assertStock(5, 65);
        await expect(transferPacks(partial.id, partial.id, 1, f.actor.id)).rejects.toThrow("different cartons");
        await executeBulkOperation("REMOVE", [full.id, partial.id], { delta: 1 }, f.actor.id);
        await assertStock(3, 39);
        await applyQcHold(full.id, "Pending inspection", f.actor.id);
        await expect(executeBulkOperation("OVERRIDE", [full.id], { newCount: 2 }, f.actor.id)).rejects.toThrow("QC hold");
        await releaseQcHold(full.id, "CONDEMNED", "Failed inspection", f.actor.id, true);
        await assertStock(2, 26);
        await retireCarton(partial.id, "DESTROYED", undefined, f.actor.id, true);
        await assertStock(0, 0);
        const replacement = await addCartonsToBatch(allocation.id, 1, f.actor.id);
        expect(replacement.created[0].currentPacks).toBe(0);
        await assertStock(0, 0);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("saves valid packaging definitions and protects definitions used by production", async () => {
    await withFixture(async (tx, f) => {
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        const definition = { productId: f.formula.productId, formulaId: f.formula.id, name: "Test recipe",
          batchSize: "999", batchUnit: "kg", fillAmount: "1000", fillUnit: "g", containerType: "pack",
          containerPackagingId: f.primary.id, cartonPackagingId: f.master.id, containersPerCarton: 4 };
        const saved = await invoke(createRecipeFn, definition, f.actor.id) as typeof f.recipe;
        expect(saved.targetUnitsPerBatch).toBe(10);
        expect(Number(saved.batchSize)).toBe(10);
        await expect(invoke(createRecipeFn, { ...definition, fillUnit: "L" }, f.actor.id)).rejects.toThrow("match");
        await expect(invoke(createRecipeFn, { ...definition, fillAmount: "0" }, f.actor.id)).rejects.toThrow("Fill amount");
        await expect(invoke(createRecipeFn, { ...definition, containersPerCarton: 0 }, f.actor.id)).rejects.toThrow("configured together");
        await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: saved.id,
          warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: "4",
          allocatedBulkUnit: "kg", allocatedChemicalCost: "40", targetContainers: 4, status: "allocated" });
        await expect(invoke(updateRecipeFn, { ...definition, id: saved.id }, f.actor.id)).rejects.toThrow("Create a new packaging format");
        const formulaDefinition = { id: f.formula.id, productId: f.formula.productId, name: "Changed",
          batchSize: 10, batchUnit: "kg", ingredients: [{ chemicalId: f.chemical.id, quantityPerBatch: 10 }] };
        await tx.update(mixingRuns).set({ status: "scheduled" }).where(eq(mixingRuns.id, f.run.id));
        await expect(invoke(updateFormulaFn, formulaDefinition, f.actor.id)).rejects.toThrow("active mixing work");
        await tx.update(mixingRuns).set({ status: "completed", actualBulkProduced: "0.300" }).where(eq(mixingRuns.id, f.run.id));
        await expect(invoke(updateFormulaFn, { ...formulaDefinition, batchUnit: "liters" }, f.actor.id)).rejects.toThrow("linked mixing formula");
        await tx.update(packagingAllocations).set({ status: "cancelled" }).where(eq(packagingAllocations.recipeId, saved.id));
        await tx.update(recipes).set({ fillAmount: "100", fillUnit: "g" }).where(eq(recipes.id, f.recipe.id));
        const allocation = { mixingRunId: f.run.id, recipeId: f.recipe.id, operatorId: f.actor.id };
        await invoke(createPackagingAllocationFn, { ...allocation, allocatedBulkQuantity: 0.1 }, f.actor.id);
        await invoke(createPackagingAllocationFn, { ...allocation, allocatedBulkQuantity: 0.2 }, f.actor.id);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("returns loose-only goods as containers and retains their value on the next receipt", async () => {
    await withFixture(async (tx, f) => {
      await tx.update(recipes).set({ cartonPackagingId: null, containersPerCarton: 0 }).where(eq(recipes.id, f.recipe.id));
      async function receipt(units: number, cost: number) {
        const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.recipe.id,
          warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: String(units),
          allocatedBulkUnit: "kg", allocatedChemicalCost: String(cost), targetContainers: units,
          completedContainers: units, status: "in_progress" }).returning();
        await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
      }
      await receipt(10, 120);
      const invoice = await postInvoice(tx, {
        ...createInvoiceSchema.parse({ customerName: "Loose test", warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"),
          items: [{ recipeId: f.recipe.id, pack: f.recipe.name, unitType: "units", numberOfUnits: 5,
            packsPerCarton: 1, perCartonPrice: 20, retailPrice: 20, isPriceOverride: true }] }),
        performedById: f.actor.id, source: "online", businessDate: new Date(), stockPolicy: "strict", creditPolicy: "block", pricingPolicy: "live",
      });
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        const item = await tx.query.invoiceItems.findFirst({ where: (item, { eq }) => eq(item.invoiceId, invoice.id) });
        const returned = await invoke(createSalesReturnFn, { invoiceId: invoice.id, reason: "Good loose goods", condition: "good",
          items: [{ invoiceItemId: item!.id, quantityReturned: 2, refundPerUnit: 20 }] }, f.actor.id) as { id: string };
        await invoke(processSalesReturnFn, { returnId: returned.id, action: "approve" }, f.actor.id);
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(stock.quantityCartons).toBe(0);
        expect(stock.quantityContainers).toBe(7);
        expect(Number(stock.totalInventoryValue)).toBe(84);
        await receipt(3, 60);
        const [next] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(next.quantityContainers).toBe(10);
        expect(Number(next.weightedAverageCostPerPack)).toBe(14.4);
        expect(Number(next.totalInventoryValue)).toBe(144);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("settles the entire chemical deduction when a formula repeats a chemical", async () => {
    await withFixture(async (tx, fixture) => {
      await tx.insert(mixingMaterialsUsed).values([
        { mixingRunId: fixture.run.id, chemicalId: fixture.chemical.id, quantityUsed: "2", costPerUnit: "10", totalCost: "20" },
        { mixingRunId: fixture.run.id, chemicalId: fixture.chemical.id, quantityUsed: "3", costPerUnit: "20", totalCost: "60" },
      ]);
      const recovery = await loadFailedProductionRecoveryContext(tx, { batchId: fixture.run.batchId, chemicalId: fixture.chemical.id });
      expect(recovery.expectedQuantity).toBe(5);
      expect(recovery.costPerUnit).toBe(16);
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        const request = { batchId: fixture.run.batchId, chemicalId: fixture.chemical.id, recoveredQuantity: 3, reason: "Spill recovered" };
        await expect(invoke(recoverFailedProductionChemicalFn, request, "another-user", ["operator.run.log"])).rejects.toThrow("another operator");
        await expect(invoke(recoverFailedProductionChemicalFn, { ...request, recoveredQuantity: 6 }, fixture.actor.id)).rejects.toThrow("cannot exceed");
        const result = await invoke(recoverFailedProductionChemicalFn, request, fixture.actor.id) as { lossQuantity: number; lossAmount: number };
        expect(result.lossQuantity).toBe(2);
        expect(result.lossAmount).toBe(32);
        const [recovered] = await tx.select().from(materialStock).where(eq(materialStock.chemicalId, fixture.chemical.id));
        expect(Number(recovered.quantity)).toBe(3);
        await expect(invoke(recoverFailedProductionChemicalFn, request, fixture.actor.id)).rejects.toThrow("already been settled");
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("conserves recorded inventory value across successive fractional and zero-cost receipts", async () => {
    await withFixture(async (tx, f) => {
      await tx.update(recipes).set({ containersPerCarton: 1000 }).where(eq(recipes.id, f.recipe.id));
      const receipts = [
        { units: 3000, chemicalCost: "100", packagingCost: "0", cost: "100.00", unitsAfter: 3000, valueAfter: "100.00" },
        { units: 1, chemicalCost: "1", packagingCost: "0", cost: "1.00", unitsAfter: 3001, valueAfter: "101.00" },
        { units: 3, chemicalCost: "0.01", packagingCost: "0.02", cost: "0.03", unitsAfter: 3004, valueAfter: "101.03" },
        { units: 1, chemicalCost: "0", packagingCost: "0", cost: "0.00", unitsAfter: 3005, valueAfter: "101.03" },
      ];
      for (const receipt of receipts) {
        const [allocation] = await tx.insert(packagingAllocations).values({
          mixingRunId: f.run.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id,
          allocatedBulkQuantity: String(receipt.units), allocatedBulkUnit: "kg", allocatedChemicalCost: receipt.chemicalCost,
          totalPackagingCost: receipt.packagingCost, targetContainers: receipt.units, completedContainers: receipt.units,
          targetCartons: Math.floor(receipt.units / 1000), status: "in_progress",
        }).returning();
        const completed = await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
        expect(completed.allocation.totalProductionCost).toBe(receipt.cost);
        expect(completed.allocation.actualPacksProduced).toBe(receipt.units);
        expect(completed.allocation.actualCartonsProduced).toBe(Math.floor(receipt.units / 1000));
        expect(completed.allocation.actualLooseUnitsProduced).toBe(receipt.units % 1000);
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(stock.quantityCartons * 1000 + stock.quantityContainers).toBe(receipt.unitsAfter);
        expect.soft(stock.totalInventoryValue).toBe(receipt.valueAfter);
        expect.soft(stock.weightedAverageCostPerPack).toBe((Number(receipt.valueAfter) / receipt.unitsAfter).toFixed(4));
        const [history] = await tx.select().from(wacHistory).where(eq(wacHistory.packagingAllocationId, allocation.id));
        expect(history.totalUnits).toBe(receipt.unitsAfter);
        expect.soft(history.totalInventoryValue).toBe(receipt.valueAfter);
        expect(history.wacPerPack).toBe(stock.weightedAverageCostPerPack);
        expect(history.wacPerCarton).toBe(stock.weightedAverageCostPerCarton);
        const receivedCartons = await tx.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
        expect(receivedCartons.reduce((sum, carton) => sum + carton.currentPacks, 0)).toBe(receipt.units);
        const ledger = await tx.select().from(adjustmentLog).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
        expect(ledger.reduce((sum, entry) => sum + entry.delta, 0)).toBe(receipt.units);
      }
      const [receivedValue] = await tx.select({ total: sql<string>`sum(${packagingAllocations.totalProductionCost})` })
        .from(packagingAllocations).where(eq(packagingAllocations.recipeId, f.recipe.id));
      const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
      expect.soft(stock.totalInventoryValue).toBe(receivedValue.total);
    });
  });

  it("receives full and partial cartons once and blends WAC on the next receipt", async () => {
    await withFixture(async (tx, fixture) => {
      async function receipt(units: number, target: number, chemicalCost: string, packagingCost: string) {
        const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: fixture.run.id, recipeId: fixture.recipe.id, warehouseId: fixture.warehouse.id, operatorId: fixture.actor.id, allocatedBulkQuantity: String(target), allocatedBulkUnit: "kg", allocatedChemicalCost: chemicalCost, totalPackagingCost: packagingCost, targetContainers: target, completedContainers: units, targetCartons: Math.floor(target / 4), status: "in_progress" }).returning();
        const result = await completePackagingAllocationCore(tx, allocation.id, fixture.actor.id, units < target ? "Machine stopped" : undefined);
        return result.allocation;
      }
      const first = await receipt(6, 6, "60", "18");
      expect(first.actualCartonsProduced).toBe(1);
      expect(first.actualLooseUnitsProduced).toBe(2);
      expect(Number(first.actualCostPerPack)).toBe(13);
      expect(Number(first.actualCostPerCarton)).toBe(52);
      await expect(completePackagingAllocationCore(tx, first.id, fixture.actor.id)).rejects.toThrow("in progress");
      const second = await receipt(2, 4, "40", "6");
      expect(second.shortfallUnits).toBe(2);
      const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, fixture.recipe.id));
      expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(8);
      expect(Number(stock.weightedAverageCostPerPack)).toBe(15.5);
      expect(Number(stock.totalInventoryValue)).toBe(124);
      const rows = await tx.select().from(cartons).where(eq(cartons.recipeId, fixture.recipe.id));
      expect(rows.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(8);
      expect(rows.every(row => row.packagingAllocationId && !row.productionRunId)).toBe(true);
      expect(rows.filter(row => row.status === "PARTIAL")).toHaveLength(2);
      const history = await tx.select().from(wacHistory).where(eq(wacHistory.recipeId, fixture.recipe.id));
      expect(history).toHaveLength(2);
      const ledger = await tx.select().from(adjustmentLog).where(eq(adjustmentLog.packagingAllocationId, first.id));
      expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(6);
    });
  });

  it("runs mixing and packaging with caps, assignment guards, cancellation release and atomic stock rollback", async () => {
    await withFixture(async (tx, f) => {
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        await tx.update(mixingRuns).set({ status: "scheduled" }).where(eq(mixingRuns.id, f.run.id));
        await tx.insert(formulaIngredients).values({ formulaId: f.formula.id, chemicalId: f.chemical.id, quantityPerBatch: "10" });
        await tx.insert(materialStock).values([
          { warehouseId: f.warehouse.id, chemicalId: f.chemical.id, quantity: "10" },
          { warehouseId: f.warehouse.id, packagingMaterialId: f.primary.id, quantity: "10" },
          { warehouseId: f.warehouse.id, packagingMaterialId: f.master.id, quantity: "0" },
        ]);
        await invoke(startMixingRunFn, { mixingRunId: f.run.id }, f.actor.id);
        await expect(invoke(startMixingRunFn, { mixingRunId: f.run.id }, f.actor.id)).rejects.toThrow("scheduled");
        await expect(invoke(completeMixingRunFn, { mixingRunId: f.run.id, shortfallReason: "No yield" }, f.actor.id)).rejects.toThrow("zero output");
        await expect(invoke(logMixingProgressFn, { mixingRunId: f.run.id, quantityProduced: 11 }, f.actor.id)).rejects.toThrow("target");
        await expect(invoke(logMixingProgressFn, { mixingRunId: f.run.id, quantityProduced: 1 }, "another-user", ["operator.run.log"])).rejects.toThrow("another operator");
        await invoke(logMixingProgressFn, { mixingRunId: f.run.id, quantityProduced: 4 }, f.actor.id, ["operator.run.log"]);
        await expect(invoke(failMixingRunFn, { id: f.run.id, reason: "Machine stopped" }, f.actor.id)).rejects.toThrow("shortfall");
        await expect(invoke(completeMixingRunFn, { mixingRunId: f.run.id }, f.actor.id)).rejects.toThrow("shortfall reason");
        await invoke(logMixingProgressFn, { mixingRunId: f.run.id, quantityProduced: 6 }, f.actor.id, ["operator.run.log"]);
        const mixed = await tx.query.mixingRuns.findFirst({ where: eq(mixingRuns.id, f.run.id) });
        expect(mixed?.status).toBe("completed");
        expect(Number(mixed?.chemicalCostPerUnit)).toBe(10);

        const request = { mixingRunId: f.run.id, recipeId: f.recipe.id, allocatedBulkQuantity: 6, operatorId: f.actor.id };
        const cancelled = await invoke(createPackagingAllocationFn, request, f.actor.id) as { allocation: { id: string } };
        await invoke(cancelPackagingAllocationFn, { allocationId: cancelled.allocation.id }, f.actor.id);
        const created = await invoke(createPackagingAllocationFn, request, f.actor.id) as { allocation: { id: string } };
        const allocationId = created.allocation.id;
        await expect(invoke(createPackagingAllocationFn, request, f.actor.id)).rejects.toThrow("Insufficient bulk");
        await invoke(startPackagingAllocationFn, { allocationId }, f.actor.id, ["operator.run.log"]);
        await expect(invoke(cancelPackagingAllocationFn, { allocationId }, f.actor.id)).rejects.toThrow("untouched");
        await expect(invoke(logPackagingProgressFn, { allocationId, containersProduced: 4 }, f.actor.id, ["operator.run.log"])).rejects.toThrow("Insufficient");
        expect(await tx.select().from(packagingProgressLogs)).toHaveLength(0);
        const [bottles] = await tx.select().from(materialStock).where(eq(materialStock.packagingMaterialId, f.primary.id));
        expect(Number(bottles.quantity)).toBe(10);
        await tx.update(materialStock).set({ quantity: "2" }).where(eq(materialStock.packagingMaterialId, f.master.id));
        await invoke(logPackagingProgressFn, { allocationId, containersProduced: 4 }, f.actor.id, ["operator.run.log"]);
        expect(await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id))).toHaveLength(0);
        await expect(invoke(logPackagingProgressFn, { allocationId, containersProduced: 3 }, f.actor.id)).rejects.toThrow("target");
        await invoke(logPackagingProgressFn, { allocationId, containersProduced: 2 }, f.actor.id, ["operator.run.log"]);
        const packed = await tx.query.packagingAllocations.findFirst({ where: eq(packagingAllocations.id, allocationId) });
        expect(packed?.status).toBe("completed");
        expect(Number(packed?.totalPackagingCost)).toBe(22);
        expect(Number(packed?.totalProductionCost)).toBe(82);
        const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(stock.quantityCartons).toBe(1);
        expect(stock.quantityContainers).toBe(2);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  it("sells only the produced packs and keeps unit dispatch aligned with allocation cartons", async () => {
    await withFixture(async (tx, f) => {
      const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: f.run.id, recipeId: f.recipe.id, warehouseId: f.warehouse.id, operatorId: f.actor.id, allocatedBulkQuantity: "6", allocatedBulkUnit: "kg", allocatedChemicalCost: "60", totalPackagingCost: "18", targetContainers: 6, completedContainers: 6, targetCartons: 1, status: "in_progress" }).returning();
      await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
      const request = (units: number, unitType: "units" | "carton" = "units") => ({
        ...createInvoiceSchema.parse({ customerName: "Test customer", warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"), items: [{ recipeId: f.recipe.id, pack: f.recipe.name, unitType, numberOfUnits: unitType === "units" ? units : 0, numberOfCartons: unitType === "carton" ? units : 0, packsPerCarton: 4, perCartonPrice: 80, retailPrice: 20, isPriceOverride: true }] }),
        performedById: f.actor.id, source: "online" as const, businessDate: new Date(), stockPolicy: "strict" as const, creditPolicy: "block" as const, pricingPolicy: "live" as const,
      });
      await expect(tx.transaction(inner => postInvoice(inner, request(7)))).rejects.toThrow("Not enough stock");
      const invoice = await postInvoice(tx, request(1));
      const [stock] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
      expect(stock.quantityCartons * 4 + stock.quantityContainers).toBe(5);
      const remainingCartons = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
      expect(remainingCartons.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(5);
      const log = await tx.select().from(adjustmentLog).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
      expect(log.reduce((sum, row) => sum + row.delta, 0)).toBe(5);
      const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(
        ((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction,
      );
      try {
        const invoiceItem = await tx.query.invoiceItems.findFirst({ where: (item, { eq }) => eq(item.invoiceId, invoice.id) });
        const returned = await invoke(createSalesReturnFn, { invoiceId: invoice.id, reason: "Good return", condition: "good", items: [{ invoiceItemId: invoiceItem!.id, quantityReturned: 1, refundPerUnit: 20 }] }, f.actor.id) as { id: string };
        await invoke(processSalesReturnFn, { returnId: returned.id, action: "approve" }, f.actor.id);
        const [restocked] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        const afterReturn = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
        expect(restocked.quantityCartons * 4 + restocked.quantityContainers).toBe(6);
        expect(afterReturn.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(6);
        expect(Number(restocked.totalInventoryValue)).toBe(78);
        await expect(invoke(processSalesReturnFn, { returnId: returned.id, action: "approve" }, f.actor.id)).rejects.toThrow("already been processed");
        await expect(invoke(createSalesReturnFn, { invoiceId: invoice.id, reason: "Excess", condition: "good", items: [{ invoiceItemId: invoiceItem!.id, quantityReturned: 1, refundPerUnit: 20 }] }, f.actor.id)).rejects.toThrow("remaining returnable");

        const standard = afterReturn.find(carton => carton.currentPacks === 4)!;
        await repackCarton(standard.id, 6, "Use a larger temporary box", f.actor.id);
        await topUpCarton(standard.id, 2, f.actor.id);
        await expect(tx.transaction(inner => postInvoice(inner, request(1, "carton")))).rejects.toThrow("complete cartons");
        await setCartonCount(standard.id, 4, f.actor.id, "Remove added correction packs");
        await repackCarton(standard.id, 4, "Restore the recipe's standard box", f.actor.id);

        const fullInvoice = await postInvoice(tx, request(1, "carton"));
        const fullItem = await tx.query.invoiceItems.findFirst({ where: (item, { eq }) => eq(item.invoiceId, fullInvoice.id) });
        const good = await invoke(createSalesReturnFn, { invoiceId: fullInvoice.id, reason: "Partial good return", condition: "good", items: [{ invoiceItemId: fullItem!.id, quantityReturned: 2, refundPerUnit: 20 }] }, f.actor.id) as { id: string };
        await invoke(processSalesReturnFn, { returnId: good.id, action: "approve" }, f.actor.id);
        const damaged = await invoke(createSalesReturnFn, { invoiceId: fullInvoice.id, reason: "Remaining damaged return", condition: "damaged", items: [{ invoiceItemId: fullItem!.id, quantityReturned: 2, refundPerUnit: 20 }] }, f.actor.id) as { id: string };
        await invoke(processSalesReturnFn, { returnId: damaged.id, action: "approve" }, f.actor.id);
        const [sellable] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        const [damagedStock] = await tx.select().from(returnedFinishedGoodsStock).where(eq(returnedFinishedGoodsStock.recipeId, f.recipe.id));
        const goodCartons = await tx.select().from(cartons).where(eq(cartons.recipeId, f.recipe.id));
        expect(sellable.quantityCartons * 4 + sellable.quantityContainers).toBe(4);
        expect(goodCartons.reduce((sum, row) => sum + row.currentPacks, 0)).toBe(4);
        expect(Number(sellable.totalInventoryValue)).toBe(52);
        expect(damagedStock.quantityCartons * 4 + damagedStock.quantityContainers).toBe(2);
        expect(Number(damagedStock.totalInventoryValue)).toBe(26);
        const ledger = await tx.select().from(adjustmentLog).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
        expect(ledger.filter(row => row.type !== "RETURN_DAMAGED").reduce((sum, row) => sum + row.delta, 0)).toBe(4);

        await postInvoice(tx, {
          ...request(1), source: "offline_import", pricingPolicy: "signed_snapshot", publicInvoiceNumber: randomUUID(),
          signedLineSnapshots: [{ stagedItemId: "test-staged-item", recipeId: f.recipe.id,
            baseCartonPrice: 80, freeCartons: 0, chargedUnits: 1, dispatchedUnits: 1,
            lineAmount: 20, wacPerPack: 10, stockUnitsSnapshot: 6 }],
        });
        const [afterOffline] = await tx.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.recipeId, f.recipe.id));
        expect(Number(afterOffline.weightedAverageCostPerPack)).toBe(13);
        expect(Number(afterOffline.totalInventoryValue)).toBe(39);

      } finally {
        transactionSpy.mockRestore();
      }
    });
  });
});
