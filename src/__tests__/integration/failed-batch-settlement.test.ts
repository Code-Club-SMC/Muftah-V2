import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, user, products, warehouses, chemicals, materialStock } from "@/db";
import { failedProductionChemicalRecoveries } from "@/db/schemas/inventory-schema";
import { formulas, mixingRuns, mixingMaterialsUsed, mixingProgressLogs } from "@/db/schemas/production-schema";
import { findOrCreateLot, type Tx } from "@/lib/inventory/material-lots.server";
import { settleFailedBatchChemicalsFn } from "@/server-functions/manufacturing/mixing/settle-failed-batch-chemicals-fn";
import { getFailedBatchesToSettleFn } from "@/server-functions/manufacturing/mixing/get-failed-batches-to-settle-fn";
import { getFailedBatchSettlementFn } from "@/server-functions/manufacturing/mixing/get-failed-batch-settlement-fn";
import { withRollback } from "./with-rollback";

// Only the session transport and the timeline writer are replaced. Handlers, locks and SQL are real.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown } | undefined;
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: NonNullable<typeof validator>) => {
        validator = schema;
        return builder;
      },
      handler:
        (handler: (input: unknown) => unknown) =>
        (input: { data?: unknown; context: unknown }) =>
          handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireFailedBatchRecoveryMiddleware: {},
  requireProductionWorkReadMiddleware: {},
}));
const logActivityQuiet = vi.fn(async () => {});
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: (...args: unknown[]) => logActivityQuiet(...(args as [])) }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

// A failed batch that took 100 kg of soda (Rs 100) and 20 kg of salt (Rs 50).
async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Mixer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "120", batchUnit: "kg" }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "100" }).returning();
  const [salt] = await tx.insert(chemicals).values({ name: `${id}-salt`, unit: "kg", costPerUnit: "50" }).returning();
  const sodaLot = await findOrCreateLot(tx, { materialType: "chemical", materialId: soda.id }, "100");
  const saltLot = await findOrCreateLot(tx, { materialType: "chemical", materialId: salt.id }, "50");
  const [run] = await tx.insert(mixingRuns).values({
    batchId: `T-${id}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, initiatorId: actor.id,
    targetBulkQuantity: "120", bulkUnit: "kg", status: "failed", actualCompletionDate: new Date(),
  }).returning();
  await tx.insert(mixingMaterialsUsed).values([
    { mixingRunId: run.id, chemicalId: soda.id, lotId: sodaLot.id, quantityUsed: "100", costPerUnit: "100", totalCost: "10000" },
    { mixingRunId: run.id, chemicalId: salt.id, lotId: saltLot.id, quantityUsed: "20", costPerUnit: "50", totalCost: "1000" },
  ]);
  const context = {
    session: { user: actor },
    authContext: { session: { user: actor }, permissions: new Set(["operator.run.fail", "operator.run.read"]) },
  };
  const settle = (items: { chemicalId: string; recoveredQuantity: number }[]) =>
    settleFailedBatchChemicalsFn({ data: { mixingRunId: run.id, reason: "Mixer broke", items }, context } as never);
  const pendingList = () => getFailedBatchesToSettleFn({ context } as never);
  const details = () => getFailedBatchSettlementFn({ data: { mixingRunId: run.id }, context } as never);
  // The read functions use the shared connection; point them at this test's transaction.
  vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx) as typeof db.select);
  vi.spyOn(db.query.mixingRuns, "findFirst").mockImplementation(tx.query.mixingRuns.findFirst.bind(tx.query.mixingRuns));
  vi.spyOn(db.query.failedProductionChemicalRecoveries, "findMany").mockImplementation(
    tx.query.failedProductionChemicalRecoveries.findMany.bind(tx.query.failedProductionChemicalRecoveries),
  );
  const stock = async (chemicalId: string) => {
    const [row] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, chemicalId)));
    return row?.quantity ?? "0.000";
  };
  return { run, soda, salt, settle, pendingList, details, stock };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("settling a failed batch's chemicals", () => {
  beforeEach(() => logActivityQuiet.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("returns and writes off several chemicals at once, and logs each to the timeline", () => withRollback(async (tx) => {
    const { run, soda, salt, settle, stock } = await seed(tx);
    const result = await settle([
      { chemicalId: soda.id, recoveredQuantity: 70 },
      { chemicalId: salt.id, recoveredQuantity: 20 },
    ]);
    expect(result.settledCount).toBe(2);
    expect(result.totalLossAmount).toBe(3000);
    expect(await stock(soda.id)).toBe("70.000");
    expect(await stock(salt.id)).toBe("20.000");

    const rows = await tx.select().from(failedProductionChemicalRecoveries).where(eq(failedProductionChemicalRecoveries.mixingRunId, run.id));
    expect(rows).toHaveLength(2);

    expect(logActivityQuiet).toHaveBeenCalledTimes(2);
    const sodaLog = (logActivityQuiet.mock.calls as unknown as [Record<string, unknown>][]).find(([event]) => (event.metadata as Record<string, unknown>).chemical === soda.name)![0];
    expect(sodaLog).toMatchObject({
      module: "manufacturing",
      action: "chemical_recovered",
      entityType: "mixing_run",
      entityId: run.id,
      entityLabel: run.batchId,
      severity: "warning",
    });
    expect(sodaLog.metadata).toMatchObject({ returnedToStock: "70.000 kg", writtenOff: "30.000 kg", lossAmountPkr: "3000.00", reason: "Mixer broke" });
  }));

  it("settles nothing when one chemical fails", () => withRollback(async (tx) => {
    const { soda, salt, settle, stock } = await seed(tx);
    await expect(settle([
      { chemicalId: soda.id, recoveredQuantity: 50 },
      { chemicalId: salt.id, recoveredQuantity: 25 },
    ])).rejects.toThrow("cannot exceed");
    expect(await stock(soda.id)).toBe("0.000");
    expect(logActivityQuiet).not.toHaveBeenCalled();
  }));

  it("refuses to settle the same chemical twice", () => withRollback(async (tx) => {
    const { soda, settle } = await seed(tx);
    await settle([{ chemicalId: soda.id, recoveredQuantity: 100 }]);
    await expect(settle([{ chemicalId: soda.id, recoveredQuantity: 0 }])).rejects.toThrow("already been settled");
  }));

  it("keeps the batch on the reminder list until every chemical is settled", () => withRollback(async (tx) => {
    const { run, soda, salt, settle, pendingList, details } = await seed(tx);
    const mine = async () => (await pendingList()).batches.find((row) => row.mixingRunId === run.id);

    expect((await mine())?.pendingChemicals).toBe(2);
    await settle([{ chemicalId: soda.id, recoveredQuantity: 100 }]);
    expect((await mine())?.pendingChemicals).toBe(1);

    const view = await details();
    expect(view.applies && view.pendingCount).toBe(1);
    expect(view.applies && view.canSettle).toBe(true);

    await settle([{ chemicalId: salt.id, recoveredQuantity: 0 }]);
    expect(await mine()).toBeUndefined();
  }));

  it("leaves batches with logged output off the reminder list", () => withRollback(async (tx) => {
    const { run, pendingList } = await seed(tx);
    await tx.insert(mixingProgressLogs).values({ mixingRunId: run.id, quantityProduced: "5", createdById: run.operatorId });
    expect((await pendingList()).batches.find((row) => row.mixingRunId === run.id)).toBeUndefined();
  }));
});
