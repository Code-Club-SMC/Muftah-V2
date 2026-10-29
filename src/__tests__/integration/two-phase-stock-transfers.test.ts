import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  db,
  user,
  warehouses,
  products,
  chemicals,
  packagingMaterials,
  recipes,
  materialStock,
  materialLots,
  materialLotStock,
  materialLotMovements,
  finishedGoodsStock,
  cartons,
  adjustmentLog,
  inventoryAuditLog,
  stockTransfers,
  wacHistory,
} from "@/db";
import {
  formulas,
  mixingRuns,
  packagingAllocations,
} from "@/db/schemas/production-schema";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";
import { toggleWarehouseStatusFn } from "@/server-functions/inventory/toggle-warehouse-status-fn";
import { updateStockFn } from "@/server-functions/inventory/stock/update-stock-fn";
import { createMixingRunFn } from "@/server-functions/manufacturing/mixing/create-mixing-run-fn";
import { createPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/create-packaging-allocation-fn";
import {
  appRoles,
  appPermissions,
  appRolePermissions,
  userRoleAssignments,
} from "@/db/schemas/rbac-schema";
import {
  retireCarton,
  removePacksFromCarton,
  transferPacks,
  mergeCartons,
  topUpCarton,
} from "@/lib/cartons/carton.service";
import { executeBulkOperation } from "@/lib/cartons/bulk.service";
import {
  findOrCreateLot,
  lockMaterialStock,
  moveLotStock,
} from "@/lib/inventory/material-lots.server";

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("rollback stock transfer fixture");

async function withFixture(
  check: (tx: Tx, f: Awaited<ReturnType<typeof seed>>) => Promise<void>,
  usesCartons = true,
  production: { units?: number; cost?: number; capacity?: number } = {},
) {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  )
    throw new Error("Use the isolated TEST_DATABASE_URL");
  try {
    await db.transaction(async (tx) => {
      const f = await seed(tx, usesCartons, production);
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation(((callback: Parameters<typeof db.transaction>[0]) =>
          tx.transaction(callback)) as typeof db.transaction);
      try {
        await check(tx, f);
      } finally {
        spy.mockRestore();
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seed(
  tx: Tx,
  usesCartons = true,
  production: { units?: number; cost?: number; capacity?: number } = {},
) {
  const units = production.units ?? 6;
  const id = randomUUID();
  const [actor] = await tx
    .insert(user)
    .values({ id, name: id, email: `${id}@test.invalid` })
    .returning();
  const [role] = await tx
    .insert(appRoles)
    .values({ slug: id, name: id })
    .returning();
  await tx
    .insert(appPermissions)
    .values(
      ["operator.run.read", "operator.run.log"].map((key) => ({
        key,
        moduleKey: "operator",
        label: key,
      })),
    )
    .onConflictDoNothing();
  const permissions = await tx
    .select()
    .from(appPermissions)
    .where(
      inArray(appPermissions.key, ["operator.run.read", "operator.run.log"]),
    );
  await tx.insert(appRolePermissions).values(
    permissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
  );
  await tx
    .insert(userRoleAssignments)
    .values({ userId: actor.id, roleId: role.id });
  const locations = await tx
    .insert(warehouses)
    .values(
      ["source", "target"].map((name) => ({
        id: `${id}-${name}`,
        name: `${id}-${name}`,
        address: "Test",
        city: "Test",
        state: "Test",
        latitude: "0",
        longitude: "0",
        type: "factory_floor",
      })),
    )
    .returning();
  const [source, target] = locations;
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [master] = await tx
    .insert(packagingMaterials)
    .values({ name: id, type: "master", costPerUnit: "1" })
    .returning();
  const [chemical] = await tx
    .insert(chemicals)
    .values({ name: id, costPerUnit: "10" })
    .returning();
  const [formula] = await tx
    .insert(formulas)
    .values({
      productId: product.id,
      name: id,
      batchSize: "10",
      batchUnit: "kg",
    })
    .returning();
  const [recipe] = await tx
    .insert(recipes)
    .values({
      productId: product.id,
      formulaId: formula.id,
      name: id,
      batchSize: "10",
      batchUnit: "kg",
      containerType: "pack",
      containerPackagingId: master.id,
      cartonPackagingId: usesCartons ? master.id : null,
      containersPerCarton: production.capacity ?? 4,
      fillAmount: "1",
      fillUnit: "kg",
    })
    .returning();
  const [run] = await tx
    .insert(mixingRuns)
    .values({
      batchId: id,
      formulaId: formula.id,
      warehouseId: source.id,
      operatorId: actor.id,
      targetBulkQuantity: String(units),
      actualBulkProduced: String(units),
      bulkUnit: "kg",
      status: "completed",
    })
    .returning();
  const [allocation] = await tx
    .insert(packagingAllocations)
    .values({
      mixingRunId: run.id,
      recipeId: recipe.id,
      warehouseId: source.id,
      operatorId: actor.id,
      allocatedBulkQuantity: String(units),
      allocatedBulkUnit: "kg",
      allocatedChemicalCost: String(production.cost ?? 78),
      targetContainers: units,
      completedContainers: units,
      status: "in_progress",
    })
    .returning();
  await completePackagingAllocationCore(tx, allocation.id, actor.id);
  return {
    actor,
    role,
    product,
    master,
    formula,
    source,
    target,
    recipe,
    run,
    allocation,
    chemical,
  };
}

async function invoke(
  fn: unknown,
  data: unknown,
  f: Awaited<ReturnType<typeof seed>>,
) {
  const session = { user: f.actor };
  const context = {
    session,
    authContext: {
      session,
      permissions: ["inventory.manage", "manufacturing.run.manage"],
    },
  };
  return (
    fn as (input: {
      data: unknown;
      context: typeof context;
    }) => Promise<unknown>
  )({ data, context });
}

function transfer(
  f: Awaited<ReturnType<typeof seed>>,
  quantity: string,
  looseUnits = "0",
  extra = {},
) {
  return invoke(
    transferStockFn,
    {
      fromWarehouseId: f.source.id,
      toWarehouseId: f.target.id,
      materialType: "finished",
      materialId: f.recipe.id,
      quantity,
      looseUnits,
      notes: "Test transfer",
      ...extra,
    },
    f,
  );
}

async function stock(
  tx: Tx,
  f: Awaited<ReturnType<typeof seed>>,
  location = f.source,
) {
  return tx.query.finishedGoodsStock.findFirst({
    where: and(
      eq(finishedGoodsStock.recipeId, f.recipe.id),
      eq(finishedGoodsStock.warehouseId, location.id),
    ),
  });
}

async function assertReconciled(tx: Tx, f: Awaited<ReturnType<typeof seed>>) {
  const rows = await tx
    .select()
    .from(cartons)
    .where(eq(cartons.packagingAllocationId, f.allocation.id));
  const ledger = await tx
    .select()
    .from(adjustmentLog)
    .where(eq(adjustmentLog.packagingAllocationId, f.allocation.id));
  expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(6);
  expect(
    rows
      .filter((row) => !["ARCHIVED", "RETIRED"].includes(row.status))
      .reduce((sum, row) => sum + row.currentPacks, 0),
  ).toBe(6);
  for (const location of [f.source, f.target]) {
    const fg = await stock(tx, f, location);
    const packs = rows
      .filter(
        (row) =>
          row.warehouseId === location.id &&
          !["ARCHIVED", "RETIRED"].includes(row.status),
      )
      .reduce((sum, row) => sum + row.currentPacks, 0);
    expect((fg?.quantityCartons ?? 0) * 4 + (fg?.quantityContainers ?? 0)).toBe(
      packs,
    );
    if (fg)
      expect(Number(fg.totalInventoryValue)).toBeCloseTo(
        packs * Number(fg.weightedAverageCostPerPack),
        2,
      );
  }
}

async function cleanup(f: Awaited<ReturnType<typeof seed>>) {
  await db.transaction(async (tx) => {
    const locations = [f.source.id, f.target.id];
    await tx
      .delete(stockTransfers)
      .where(inArray(stockTransfers.fromWarehouseId, locations));
    const fixtureCartons = await tx
      .select({ id: cartons.id })
      .from(cartons)
      .where(inArray(cartons.warehouseId, locations));
    if (fixtureCartons.length)
      await tx.delete(adjustmentLog).where(
        inArray(
          adjustmentLog.cartonId,
          fixtureCartons.map((row) => row.id),
        ),
      );
    await tx.delete(cartons).where(inArray(cartons.warehouseId, locations));
    await tx
      .delete(wacHistory)
      .where(inArray(wacHistory.warehouseId, locations));
    await tx
      .delete(finishedGoodsStock)
      .where(inArray(finishedGoodsStock.warehouseId, locations));
    await tx
      .delete(materialStock)
      .where(inArray(materialStock.warehouseId, locations));
    await tx
      .delete(inventoryAuditLog)
      .where(inArray(inventoryAuditLog.warehouseId, locations));
    await tx
      .delete(packagingAllocations)
      .where(inArray(packagingAllocations.warehouseId, locations));
    await tx
      .delete(mixingRuns)
      .where(inArray(mixingRuns.warehouseId, locations));
    await tx.delete(recipes).where(eq(recipes.productId, f.product.id));
    await tx.delete(formulas).where(eq(formulas.id, f.formula.id));
    await tx
      .delete(materialLotMovements)
      .where(inArray(materialLotMovements.warehouseId, locations));
    await tx
      .delete(materialLotStock)
      .where(inArray(materialLotStock.warehouseId, locations));
    await tx
      .delete(materialLots)
      .where(
        or(
          eq(materialLots.chemicalId, f.chemical.id),
          eq(materialLots.packagingMaterialId, f.master.id),
        ),
      );
    await tx
      .delete(packagingMaterials)
      .where(eq(packagingMaterials.id, f.master.id));
    await tx.delete(chemicals).where(eq(chemicals.id, f.chemical.id));
    await tx.delete(products).where(eq(products.id, f.product.id));
    await tx.delete(warehouses).where(inArray(warehouses.id, locations));
    await tx.delete(user).where(eq(user.id, f.actor.id));
    await tx.delete(appRoles).where(eq(appRoles.id, f.role.id));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Pause only after a real SQL lock is granted. The other endpoint must wait on
// another PostgreSQL backend before the holder is allowed to commit.
async function assertBlocked(
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
  matches: (query: { sql: string; params: unknown[] }) => boolean,
) {
  const original = db.transaction.bind(db);
  const acquired = deferred<number>();
  const contender = deferred<number>();
  const release = deferred<void>();
  const dialect = new PgDialect();
  let index = 0;
  const spy = vi.spyOn(db, "transaction").mockImplementation(((
    callback: Parameters<typeof db.transaction>[0],
  ) => {
    const holder = index++ === 0;
    return original(async (tx) => {
      const {
        rows: [backend],
      } = await tx.execute<{ pid: number }>(
        sql`SELECT pg_backend_pid() AS pid`,
      );
      if (!holder) {
        contender.resolve(backend.pid);
        return callback(tx);
      }
      let paused = false;
      const pause = async (query: { sql: string; params: unknown[] }) => {
        if (!paused && matches(query)) {
          paused = true;
          acquired.resolve(backend.pid);
          await release.promise;
        }
      };
      // Drizzle SELECT builders execute on await, while advisory locks use execute.
      const wrap = (builder: object): object =>
        new Proxy(builder, {
          get(target, key) {
            const value = Reflect.get(target, key);
            if (key === "then")
              return (
                resolve: (value: unknown) => unknown,
                reject: (error: unknown) => unknown,
              ) =>
                value
                  .call(target, async (result: unknown) => {
                    await pause(
                      dialect.sqlToQuery(
                        Reflect.get(target, "getSQL").call(target),
                      ),
                    );
                    return result;
                  })
                  .then(resolve, reject);
            if (typeof value === "function")
              return (...args: unknown[]) => {
                const result = value.apply(target, args);
                return typeof result === "object" && result !== null
                  ? wrap(result)
                  : result;
              };
            return value;
          },
        });
      const instrumented = new Proxy(tx, {
        get(target, key) {
          if (key === "select")
            return (...args: unknown[]) =>
              wrap(Reflect.apply(Reflect.get(target, key), target, args));
          if (key === "execute")
            return async (statement: Parameters<Tx["execute"]>[0]) => {
              const result = await target.execute(statement);
              if (typeof statement !== "string")
                await pause(dialect.sqlToQuery(statement.getSQL()));
              return result;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return callback(instrumented);
    });
  }) as typeof db.transaction);
  const holder = first();
  void holder.then(
    () => acquired.reject(new Error("Expected holder lock was not acquired")),
    acquired.reject,
  );
  let waiter: Promise<unknown> | undefined;
  try {
    const holderPid = await acquired.promise;
    waiter = second();
    void waiter.catch(contender.reject);
    const waiterPid = await contender.promise;
    expect(waiterPid).not.toBe(holderPid);
    const deadline = Date.now() + 10_000;
    let blocked = false;
    while (Date.now() < deadline) {
      const {
        rows: [row],
      } = await db.execute<{ blocked: boolean }>(
        sql`SELECT ${holderPid} = ANY(pg_blocking_pids(${waiterPid})) AS blocked`,
      );
      if (row.blocked) {
        blocked = true;
        break;
      }
    }
    expect(
      blocked,
      "the contender must wait on the holder's actual database lock",
    ).toBe(true);
    release.resolve();
    return await Promise.allSettled([holder, waiter]);
  } finally {
    release.resolve();
    await Promise.allSettled([holder, ...(waiter ? [waiter] : [])]);
    spy.mockRestore();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "reachable inventory transfers preserve production stock",
  () => {
    it("records unsealing when loose transfer splits a sealed carton", async () =>
      withFixture(async (tx, f) => {
        await tx
          .update(cartons)
          .set({ status: "SEALED" })
          .where(
            and(
              eq(cartons.packagingAllocationId, f.allocation.id),
              eq(cartons.status, "COMPLETE"),
            ),
          );
        await transfer(f, "0", "3");
        expect(
          await tx.query.adjustmentLog.findFirst({
            where: and(
              eq(adjustmentLog.packagingAllocationId, f.allocation.id),
              eq(adjustmentLog.type, "UNSEALED"),
            ),
          }),
        ).toMatchObject({ delta: 0, packsBefore: 4, packsAfter: 4 });
        await assertReconciled(tx, f);
      }));
    it("conserves the recorded currency value across partial and final inventory transfers", async () =>
      withFixture(
        async (tx, f) => {
          expect(await stock(tx, f)).toMatchObject({
            totalInventoryValue: "100.00",
            weightedAverageCostPerPack: "0.0333",
          });
          await transfer(f, "0", "1500");
          expect(await stock(tx, f)).toMatchObject({
            totalInventoryValue: "50.00",
            quantityContainers: 1500,
          });
          expect(await stock(tx, f, f.target)).toMatchObject({
            totalInventoryValue: "50.00",
            quantityContainers: 1500,
          });
          await transfer(f, "0", "1500");
          expect(await stock(tx, f)).toMatchObject({
            totalInventoryValue: "0.00",
            quantityContainers: 0,
          });
          expect(await stock(tx, f, f.target)).toMatchObject({
            totalInventoryValue: "100.00",
            quantityCartons: 1,
          });
        },
        true,
        { units: 3000, cost: 100, capacity: 3000 },
      ));
    it("conserves fractional WAC value in carton transfers and cross-warehouse merges", async () =>
      withFixture(
        async (tx, f) => {
          const source = await tx.query.cartons.findFirst({
            where: eq(cartons.packagingAllocationId, f.allocation.id),
          });
          await tx
            .insert(finishedGoodsStock)
            .values({ warehouseId: f.target.id, recipeId: f.recipe.id });
          const [target] = await tx
            .insert(cartons)
            .values({
              warehouseId: f.target.id,
              recipeId: f.recipe.id,
              packagingAllocationId: f.allocation.id,
              sku: source!.sku,
              capacity: 3000,
              currentPacks: 0,
              status: "PARTIAL",
            })
            .returning();
          await transferPacks(source!.id, target.id, 1500, f.actor.id);
          expect(await stock(tx, f)).toMatchObject({
            totalInventoryValue: "50.00",
          });
          expect(await stock(tx, f, f.target)).toMatchObject({
            totalInventoryValue: "50.00",
          });
          await mergeCartons([source!.id], target.id, f.actor.id);
          expect(await stock(tx, f)).toMatchObject({
            totalInventoryValue: "0.00",
          });
          expect(await stock(tx, f, f.target)).toMatchObject({
            totalInventoryValue: "100.00",
          });
        },
        true,
        { units: 3000, cost: 100, capacity: 3000 },
      ));
    it("credits the full recorded value when deactivation blends fractional WAC stock", async () =>
      withFixture(
        async (tx, f) => {
          await tx.insert(finishedGoodsStock).values({
            warehouseId: f.target.id,
            recipeId: f.recipe.id,
            quantityContainers: 100,
            weightedAverageCostPerPack: "1",
            totalInventoryValue: "100",
          });
          await invoke(
            toggleWarehouseStatusFn,
            {
              warehouseId: f.source.id,
              isActive: false,
              transferToWarehouseId: f.target.id,
            },
            f,
          );
          expect(await stock(tx, f)).toMatchObject({
            totalInventoryValue: "0.00",
          });
          expect(await stock(tx, f, f.target)).toMatchObject({
            totalInventoryValue: "200.00",
            quantityCartons: 1,
            quantityContainers: 100,
            weightedAverageCostPerPack: "0.0645",
          });
        },
        true,
        { units: 3000, cost: 100, capacity: 3000 },
      ));
    it("relocates empty carton history with a zero-stock row for later carton receipts", async () =>
      withFixture(async (tx, f) => {
        const rows = await tx
          .select()
          .from(cartons)
          .where(eq(cartons.packagingAllocationId, f.allocation.id));
        for (const row of rows)
          await removePacksFromCarton(
            row.id,
            row.currentPacks,
            f.actor.id,
            "OTHER",
          );
        await invoke(
          toggleWarehouseStatusFn,
          {
            warehouseId: f.source.id,
            isActive: false,
            transferToWarehouseId: f.target.id,
          },
          f,
        );
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityCartons: 0,
          quantityContainers: 0,
          weightedAverageCostPerPack: "13.0000",
          totalInventoryValue: "0.00",
        });
        await topUpCarton(rows[0].id, 1, f.actor.id);
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityContainers: 1,
          totalInventoryValue: "13.00",
        });
      }));
    it("moves one full carton out of a six-pack receipt without counting its partial carton twice", async () =>
      withFixture(async (tx, f) => {
        await transfer(f, "1");
        expect(await stock(tx, f)).toMatchObject({
          quantityCartons: 0,
          quantityContainers: 2,
          totalInventoryValue: "26.00",
        });
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityCartons: 1,
          quantityContainers: 0,
          totalInventoryValue: "52.00",
        });
        expect(
          (
            await tx
              .select()
              .from(adjustmentLog)
              .where(eq(adjustmentLog.packagingAllocationId, f.allocation.id))
          ).filter((row) => row.type.startsWith("TRANSFER_")),
        ).toHaveLength(2);
        await assertReconciled(tx, f);
      }));

    it("splits loose packs with their allocation trace and conserves value", async () =>
      withFixture(async (tx, f) => {
        await transfer(f, "0", "1");
        expect(await stock(tx, f)).toMatchObject({
          quantityCartons: 1,
          quantityContainers: 1,
          totalInventoryValue: "65.00",
        });
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityCartons: 0,
          quantityContainers: 1,
          totalInventoryValue: "13.00",
        });
        const destination = await tx.query.cartons.findFirst({
          where: eq(cartons.warehouseId, f.target.id),
        });
        expect(destination).toMatchObject({
          packagingAllocationId: f.allocation.id,
          currentPacks: 1,
          status: "PARTIAL",
        });
        await assertReconciled(tx, f);
      }));

    it("rejects partial cartons as full cartons and excludes held packs", async () =>
      withFixture(async (tx, f) => {
        const full = await tx.query.cartons.findFirst({
          where: and(
            eq(cartons.packagingAllocationId, f.allocation.id),
            eq(cartons.status, "COMPLETE"),
          ),
        });
        await tx
          .update(cartons)
          .set({ status: "ON_HOLD", preHoldStatus: "COMPLETE" })
          .where(eq(cartons.id, full!.id));
        await expect(transfer(f, "1")).rejects.toThrow(/carton|stock/i);
        await expect(transfer(f, "0", "3")).rejects.toThrow(/pack|stock/i);
        await assertReconciled(tx, f);
      }));

    it("rejects negative, fractional and malformed finished transfer quantities", async () =>
      withFixture(async (_tx, f) => {
        for (const [quantity, loose] of [
          ["-1", "1"],
          ["0.5", "0"],
          ["0", "1.5"],
          ["NaN", "1"],
          ["Infinity", "0"],
        ]) {
          await expect(transfer(f, quantity, loose)).rejects.toThrow();
        }
      }));

    it("preserves loose-only finished-stock transfers", async () =>
      withFixture(async (tx, f) => {
        await transfer(f, "0", "3");
        expect(await stock(tx, f)).toMatchObject({
          quantityContainers: 3,
          totalInventoryValue: "39.00",
        });
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityContainers: 3,
          totalInventoryValue: "39.00",
        });
      }, false));

    it("deactivation relocates held and partial cartons, blending the destination WAC", async () =>
      withFixture(async (tx, f) => {
        await tx.insert(materialStock).values({
          warehouseId: f.source.id,
          chemicalId: f.chemical.id,
          quantity: "0.300",
        });
        await tx
          .update(cartons)
          .set({
            status: "ON_HOLD",
            preHoldStatus: "PARTIAL",
            holdReason: "Test",
          })
          .where(
            and(
              eq(cartons.packagingAllocationId, f.allocation.id),
              eq(cartons.status, "PARTIAL"),
            ),
          );
        await tx.insert(finishedGoodsStock).values({
          warehouseId: f.target.id,
          recipeId: f.recipe.id,
          quantityCartons: 1,
          quantityContainers: 0,
          weightedAverageCostPerPack: "20",
          weightedAverageCostPerCarton: "80",
          totalInventoryValue: "80",
        });
        // A preexisting destination receipt can belong to another allocation.
        await tx.insert(cartons).values({
          warehouseId: f.target.id,
          recipeId: f.recipe.id,
          packagingAllocationId: null,
          capacity: 4,
          currentPacks: 4,
          status: "COMPLETE",
        });
        await invoke(
          toggleWarehouseStatusFn,
          {
            warehouseId: f.source.id,
            isActive: false,
            transferToWarehouseId: f.target.id,
          },
          f,
        );
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityCartons: 2,
          quantityContainers: 2,
          weightedAverageCostPerPack: "15.8000",
          totalInventoryValue: "158.00",
        });
        expect(
          (
            await tx
              .select()
              .from(cartons)
              .where(eq(cartons.packagingAllocationId, f.allocation.id))
          ).every((row) => row.warehouseId === f.target.id),
        ).toBe(true);
        expect((await stock(tx, f))?.quantityCartons ?? 0).toBe(0);
        expect((await stock(tx, f))?.quantityContainers ?? 0).toBe(0);
        expect(
          (
            await tx
              .select()
              .from(adjustmentLog)
              .where(eq(adjustmentLog.packagingAllocationId, f.allocation.id))
          ).filter((row) => row.type.startsWith("TRANSFER_")),
        ).toHaveLength(4);
        expect(
          (
            await tx
              .select()
              .from(inventoryAuditLog)
              .where(eq(inventoryAuditLog.materialId, f.chemical.id))
          ).map((row) => ({ type: row.type, amount: row.amount })),
        ).toEqual(
          expect.arrayContaining([
            { type: "debit", amount: "0.300" },
            { type: "credit", amount: "0.300" },
          ]),
        );
        expect(
          await tx.query.warehouses.findFirst({
            where: eq(warehouses.id, f.source.id),
          }),
        ).toMatchObject({ isActive: false });
      }));

    it("blocks deactivation while mixing or packaging is still live", async () =>
      withFixture(async (tx, f) => {
        await tx
          .update(mixingRuns)
          .set({ status: "scheduled" })
          .where(eq(mixingRuns.id, f.run.id));
        await expect(
          invoke(
            toggleWarehouseStatusFn,
            {
              warehouseId: f.source.id,
              isActive: false,
              transferToWarehouseId: f.target.id,
            },
            f,
          ),
        ).rejects.toThrow(/manufacturing|mixing|production/i);
        await tx
          .update(mixingRuns)
          .set({ status: "completed" })
          .where(eq(mixingRuns.id, f.run.id));
        await tx
          .update(packagingAllocations)
          .set({ status: "allocated" })
          .where(eq(packagingAllocations.id, f.allocation.id));
        await expect(
          invoke(
            toggleWarehouseStatusFn,
            { warehouseId: f.source.id, isActive: false },
            f,
          ),
        ).rejects.toThrow(/manufacturing|packaging|production/i);
      }));

    it("transfers fractional raw stock by guarded debit and rejects negative transfers", async () =>
      withFixture(async (tx, f) => {
        const ref = { materialType: "chemical" as const, materialId: f.chemical.id };
        await lockMaterialStock(tx, [f.source.id], [ref]);
        const lot = await findOrCreateLot(tx, ref, "13");
        await moveLotStock(tx, {
          ref,
          lotId: lot.id,
          warehouseId: f.source.id,
          delta: "0.300",
          sourceType: "purchase",
        });
        await transfer(f, "0.100", "0", {
          materialType: "chemical",
          materialId: f.chemical.id,
          lotPicks: [{ lotId: lot.id, quantity: "0.100" }],
        });
        expect(
          await tx.query.materialStock.findFirst({
            where: and(
              eq(materialStock.warehouseId, f.source.id),
              eq(materialStock.chemicalId, f.chemical.id),
            ),
          }),
        ).toMatchObject({ quantity: "0.200" });
        expect(
          await tx.query.materialStock.findFirst({
            where: and(
              eq(materialStock.warehouseId, f.target.id),
              eq(materialStock.chemicalId, f.chemical.id),
            ),
          }),
        ).toMatchObject({ quantity: "0.100" });
        await expect(
          transfer(f, "-1", "1", {
            materialType: "chemical",
            materialId: f.chemical.id,
          }),
        ).rejects.toThrow();
        await expect(
          transfer(f, "0.0000000001", "0", {
            materialType: "chemical",
            materialId: f.chemical.id,
          }),
        ).rejects.toThrow(/three decimal places/i);
        await expect(
          transfer(f, "1000000000", "0", {
            materialType: "chemical",
            materialId: f.chemical.id,
          }),
        ).rejects.toThrow(/three decimal places/i);
      }));

    it("rejects packaging admission after its mixing warehouse has been deactivated", async () =>
      withFixture(async (tx, f) => {
        await tx
          .update(mixingRuns)
          .set({ actualBulkProduced: "10" })
          .where(eq(mixingRuns.id, f.run.id));
        await invoke(
          toggleWarehouseStatusFn,
          { warehouseId: f.source.id, isActive: false },
          f,
        );
        await expect(
          invoke(
            createPackagingAllocationFn,
            {
              mixingRunId: f.run.id,
              recipeId: f.recipe.id,
              allocatedBulkQuantity: 1,
              operatorId: f.actor.id,
            },
            f,
          ),
        ).rejects.toThrow(/active|warehouse/i);
        await expect(
          invoke(
            createMixingRunFn,
            {
              formulaId: f.run.formulaId,
              warehouseId: f.source.id,
              operatorId: f.actor.id,
            },
            f,
          ),
        ).rejects.toThrow(/active|warehouse/i);
      }));

    it("preserves legacy finished stock without carton records", async () =>
      withFixture(async (tx, f) => {
        await tx
          .delete(adjustmentLog)
          .where(eq(adjustmentLog.packagingAllocationId, f.allocation.id));
        await tx
          .delete(cartons)
          .where(eq(cartons.packagingAllocationId, f.allocation.id));
        await tx
          .update(recipes)
          .set({ formulaId: null })
          .where(eq(recipes.id, f.recipe.id));
        await transfer(f, "1");
        expect(await stock(tx, f)).toMatchObject({
          quantityContainers: 2,
          totalInventoryValue: "26.00",
        });
        expect(await stock(tx, f, f.target)).toMatchObject({
          quantityCartons: 1,
          totalInventoryValue: "52.00",
        });
      }));

    it("serializes a full-carton transfer against a manual mutation on another connection", async () => {
      const f = await db.transaction(seed);
      try {
        const full = await db.query.cartons.findFirst({
          where: and(
            eq(cartons.packagingAllocationId, f.allocation.id),
            eq(cartons.status, "COMPLETE"),
          ),
        });
        const results = await assertBlocked(
          () => transfer(f, "1"),
          () => retireCarton(full!.id, "Test", undefined, f.actor.id, true),
          (query) =>
            query.sql.includes("pg_advisory_xact_lock") &&
            query.params.includes(f.source.id) &&
            query.params.includes(f.recipe.id),
        );
        expect(results[0].status).toBe("fulfilled");
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringMatching(/moved|retry|changed/i),
          }),
        });
        await db.transaction((tx) => assertReconciled(tx, f));
      } finally {
        await cleanup(f);
      }
    });

    it("serializes packaging creation against warehouse deactivation on another connection", async () => {
      const f = await db.transaction(seed);
      try {
        await db
          .update(mixingRuns)
          .set({ actualBulkProduced: "10" })
          .where(eq(mixingRuns.id, f.run.id));
        const results = await assertBlocked(
          () =>
            invoke(
              toggleWarehouseStatusFn,
              { warehouseId: f.source.id, isActive: false },
              f,
            ),
          () =>
            invoke(
              createPackagingAllocationFn,
              {
                mixingRunId: f.run.id,
                recipeId: f.recipe.id,
                allocatedBulkQuantity: 1,
                operatorId: f.actor.id,
              },
              f,
            ),
          (query) =>
            query.sql.includes('from "warehouses"') &&
            (query.sql.includes("for update") ||
              query.sql.includes("for no key update")) &&
            query.params.includes(f.source.id),
        );
        expect(results[0].status).toBe("fulfilled");
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringMatching(
              /active.*warehouse|active.*factory/i,
            ),
          }),
        });
      } finally {
        await cleanup(f);
      }
    });
    it("allows carton audit foreign keys while deactivation waits for stock on another connection", async () => {
      const f = await db.transaction(seed);
      try {
        const full = await db.query.cartons.findFirst({
          where: and(
            eq(cartons.packagingAllocationId, f.allocation.id),
            eq(cartons.status, "COMPLETE"),
          ),
        });
        const results = await assertBlocked(
          () => removePacksFromCarton(full!.id, 1, f.actor.id, "OTHER"),
          () =>
            invoke(
              toggleWarehouseStatusFn,
              {
                warehouseId: f.source.id,
                isActive: false,
                transferToWarehouseId: f.target.id,
              },
              f,
            ),
          (query) =>
            query.sql.includes("pg_advisory_xact_lock") &&
            query.params.includes(f.source.id) &&
            query.params.includes(f.recipe.id),
        );
        expect(results.map((result) => result.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
        expect(
          await db.transaction((tx) => stock(tx, f, f.target)),
        ).toMatchObject({
          quantityCartons: 1,
          quantityContainers: 1,
          totalInventoryValue: "65.00",
        });
      } finally {
        await cleanup(f);
      }
    });
    it("allows raw stock audit foreign keys while deactivation waits for stock on another connection", async () => {
      const f = await db.transaction(seed);
      try {
        const [raw] = await db
          .insert(materialStock)
          .values({
            warehouseId: f.source.id,
            chemicalId: f.chemical.id,
            quantity: "0.300",
          })
          .returning();
        const results = await assertBlocked(
          () =>
            invoke(
              updateStockFn,
              {
                stockId: raw.id,
                quantity: "0.100",
                adjustmentType: "subtract",
                reason: "Race regression",
              },
              f,
            ),
          () =>
            invoke(
              toggleWarehouseStatusFn,
              {
                warehouseId: f.source.id,
                isActive: false,
                transferToWarehouseId: f.target.id,
              },
              f,
            ),
          (query) =>
            query.sql.includes('from "material_stock"') &&
            query.sql.includes("for update") &&
            query.params.includes(raw.id),
        );
        expect(results.map((result) => result.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
        expect(
          await db.query.materialStock.findFirst({
            where: and(
              eq(materialStock.warehouseId, f.target.id),
              eq(materialStock.chemicalId, f.chemical.id),
            ),
          }),
        ).toMatchObject({ quantity: "0.200" });
      } finally {
        await cleanup(f);
      }
    });
    it("locks all recipes in global warehouse order during deactivation versus a mixed bulk operation", async () => {
      const f = await db.transaction(seed);
      try {
        expect(f.source.id.localeCompare(f.target.id)).toBeLessThan(0);
        await transfer(f, "0", "2");
        const secondRecipe = await db.transaction(async (tx) => {
          const [recipe] = await tx
            .insert(recipes)
            .values({
              ...f.recipe,
              id: `${f.recipe.id}-2`,
              name: `${f.recipe.name}-2`,
            })
            .returning();
          await tx
            .update(mixingRuns)
            .set({ actualBulkProduced: "10" })
            .where(eq(mixingRuns.id, f.run.id));
          const [allocation] = await tx
            .insert(packagingAllocations)
            .values({
              mixingRunId: f.run.id,
              recipeId: recipe.id,
              warehouseId: f.source.id,
              operatorId: f.actor.id,
              allocatedBulkQuantity: "4",
              allocatedBulkUnit: "kg",
              allocatedChemicalCost: "52",
              targetContainers: 4,
              completedContainers: 4,
              status: "in_progress",
            })
            .returning();
          await completePackagingAllocationCore(tx, allocation.id, f.actor.id);
          return recipe;
        });
        const firstAtTarget = await db.query.cartons.findFirst({
          where: and(
            eq(cartons.recipeId, f.recipe.id),
            eq(cartons.warehouseId, f.target.id),
          ),
        });
        const secondAtSource = await db.query.cartons.findFirst({
          where: and(
            eq(cartons.recipeId, secondRecipe.id),
            eq(cartons.warehouseId, f.source.id),
          ),
        });
        const results = await assertBlocked(
          () =>
            invoke(
              toggleWarehouseStatusFn,
              {
                warehouseId: f.source.id,
                isActive: false,
                transferToWarehouseId: f.target.id,
              },
              f,
            ),
          () =>
            executeBulkOperation(
              "REMOVE",
              [firstAtTarget!.id, secondAtSource!.id],
              { delta: 1 },
              f.actor.id,
            ),
          (query) =>
            query.sql.includes("pg_advisory_xact_lock") &&
            query.params.includes(f.target.id) &&
            query.params.includes(f.recipe.id),
        );
        expect(results[0].status).toBe("fulfilled");
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringMatching(/moved|retry|changed/i),
          }),
        });
        expect(
          await db.query.finishedGoodsStock.findFirst({
            where: and(
              eq(finishedGoodsStock.warehouseId, f.target.id),
              eq(finishedGoodsStock.recipeId, secondRecipe.id),
            ),
          }),
        ).toMatchObject({ quantityCartons: 1, totalInventoryValue: "52.00" });
        expect(
          await db.transaction((tx) => stock(tx, f, f.target)),
        ).toMatchObject({
          quantityCartons: 1,
          quantityContainers: 2,
          totalInventoryValue: "78.00",
        });
      } finally {
        await cleanup(f);
      }
    });
  },
);
