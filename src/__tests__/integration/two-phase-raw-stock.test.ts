import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, user, warehouses, chemicals, packagingMaterials, materialStock, inventoryAuditLog, suppliers, wallets, purchaseRecords, supplierPayments, expenses, transactions, materialLots, materialLotStock, materialLotMovements } from "@/db";
import { adjustStockFn } from "@/server-functions/inventory/stock/adjust-stock-fn";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { findOrCreateLot } from "@/lib/inventory/material-lots.server";

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MaterialType = "chemical" | "packaging";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function invoke(fn: unknown, data: unknown, actorId: string) {
  const session = { user: { id: actorId, name: "Raw stock actor" } };
  return (fn as (input: unknown) => Promise<unknown>)({ data, context: { session, authContext: { session } } });
}

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Raw stock actor", email: `${id}@test.invalid` }).returning();
  const [warehouse] = await tx.insert(warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
  const [chemical] = await tx.insert(chemicals).values({ name: id, costPerUnit: "10" }).returning();
  const [packaging] = await tx.insert(packagingMaterials).values({ name: id, costPerUnit: "10" }).returning();
  const stock = await tx.insert(materialStock).values([
    { warehouseId: warehouse.id, chemicalId: chemical.id, quantity: "10" },
    { warehouseId: warehouse.id, packagingMaterialId: packaging.id, quantity: "10" },
  ]).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: id }).returning();
  const [wallet] = await tx.insert(wallets).values({ id, name: id, type: "cash", balance: "100" }).returning();
  // Lots at the items' current price, so adjustments can name them. Their stock appears on first lock.
  const lots = {
    chemical: await findOrCreateLot(tx, { materialType: "chemical", materialId: chemical.id }, "10"),
    packaging: await findOrCreateLot(tx, { materialType: "packaging", materialId: packaging.id }, "10"),
  };
  return { actor, warehouse, chemical, packaging, stock, supplier, wallet, lots };
}
type Fixture = Awaited<ReturnType<typeof seed>>;

async function withFixture(check: (f: Fixture) => Promise<void>) {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")) {
    throw new Error("Raw stock regressions require an isolated TEST_DATABASE_URL ending in _test");
  }
  // Commit only this fixture, so independent backends see the same stock rows.
  const f = await db.transaction(seed);
  try { await check(f); }
  finally {
    await db.transaction(async tx => {
      await tx.delete(transactions).where(eq(transactions.walletId, f.wallet.id));
      await tx.delete(expenses).where(eq(expenses.walletId, f.wallet.id));
      await tx.delete(supplierPayments).where(eq(supplierPayments.supplierId, f.supplier.id));
      await tx.delete(purchaseRecords).where(eq(purchaseRecords.warehouseId, f.warehouse.id));
      await tx.delete(inventoryAuditLog).where(eq(inventoryAuditLog.warehouseId, f.warehouse.id));
      await tx.delete(materialStock).where(eq(materialStock.warehouseId, f.warehouse.id));
      await tx.delete(materialStock).where(eq(materialStock.chemicalId, f.chemical.id));
      await tx.delete(materialStock).where(eq(materialStock.packagingMaterialId, f.packaging.id));
      const lotIds = [f.lots.chemical.id, f.lots.packaging.id];
      await tx.delete(inventoryAuditLog).where(inArray(inventoryAuditLog.lotId, lotIds));
      await tx.delete(materialLotMovements).where(inArray(materialLotMovements.lotId, lotIds));
      await tx.delete(materialLotStock).where(inArray(materialLotStock.lotId, lotIds));
      await tx.delete(materialLots).where(eq(materialLots.chemicalId, f.chemical.id));
      await tx.delete(materialLots).where(eq(materialLots.packagingMaterialId, f.packaging.id));
      await tx.delete(chemicals).where(eq(chemicals.id, f.chemical.id));
      await tx.delete(packagingMaterials).where(eq(packagingMaterials.id, f.packaging.id));
      await tx.delete(suppliers).where(eq(suppliers.id, f.supplier.id));
      await tx.delete(wallets).where(eq(wallets.id, f.wallet.id));
      await tx.delete(warehouses).where(eq(warehouses.id, f.warehouse.id));
      await tx.delete(user).where(eq(user.id, f.actor.id));
    });
  }
}

function material(f: Fixture, type: MaterialType) {
  const materialId = type === "chemical" ? f.chemical.id : f.packaging.id;
  const stock = f.stock.find(row => (type === "chemical" ? row.chemicalId : row.packagingMaterialId) === materialId)!;
  return { materialId, stock, lotId: f.lots[type].id };
}

// A waiter may queue behind the holder directly, or behind a sibling that already queued on it.
async function waitForBlock(holderPid: number | number[], waiterPid: number) {
  const holders = [holderPid].flat();
  expect(holders).not.toContain(waiterPid);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows: [activity] } = await db.execute<{ blocked: boolean; wait_event_type: string }>(sql`
      SELECT pg_blocking_pids(${waiterPid}) && ${`{${holders.join(",")}}`}::int[] AS blocked, wait_event_type
      FROM pg_stat_activity WHERE pid = ${waiterPid}`);
    if (activity?.blocked && activity.wait_event_type === "Lock") return;
  }
  throw new Error("The competing raw-stock transaction did not wait on the held database lock");
}

// Hold a real production-style guarded debit before starting the inventory handler.
// Its read must wait for the debit to commit before it calculates an absolute balance.
async function afterHeldDebit(f: Fixture, type: MaterialType, mutation: () => Promise<unknown>) {
  const originalTransaction = db.transaction.bind(db);
  const acquired = deferred<number>();
  const started = deferred<number>();
  const release = deferred<void>();
  const { stock, materialId } = material(f, type);
  const debit = originalTransaction(async tx => {
    const { rows: [backend] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    const deducted = await tx.update(materialStock).set({ quantity: sql`${materialStock.quantity} - 10` })
      .where(and(eq(materialStock.id, stock.id), gte(materialStock.quantity, "10"))).returning();
    expect(deducted).toHaveLength(1);
    await tx.insert(inventoryAuditLog).values({ warehouseId: f.warehouse.id, materialType: type, materialId,
      type: "debit", amount: "10", reason: "Production guarded debit", performedById: f.actor.id });
    acquired.resolve(backend.pid);
    await release.promise;
  });
  void debit.catch(acquired.reject);
  let operation: Promise<unknown> | undefined;
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const holderPid = await acquired.promise;
    spy = vi.spyOn(db, "transaction").mockImplementation(
      ((callback: Parameters<typeof db.transaction>[0]) => originalTransaction(async tx => {
        const { rows: [backend] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        started.resolve(backend.pid);
        return callback(tx);
      })) as typeof db.transaction,
    );
    operation = mutation();
    void operation.catch(started.reject);
    await waitForBlock(holderPid, await started.promise);
    release.resolve();
    const [debitResult, mutationResult] = await Promise.allSettled([debit, operation]);
    expect(debitResult.status).toBe("fulfilled");
    return mutationResult;
  } finally {
    release.resolve();
    await Promise.allSettled([debit, ...(operation ? [operation] : [])]);
    spy?.mockRestore();
  }
}

function purchaseData(f: Fixture, type: MaterialType, paid = false) {
  return { warehouseId: f.warehouse.id, materialType: type, materialId: material(f, type).materialId,
    quantity: "1", supplierId: f.supplier.id, cost: "10", notes: "Raw stock race purchase",
    paymentMethod: paid ? f.wallet.id : "pay_later", walletId: paid ? f.wallet.id : "",
    paymentStatus: paid ? "paid" : "unpaid", amountPaid: "", transactionId: "", bankName: "" };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("two phase raw stock serialization", () => {
  it("rejects purchases into an inactive floor and manually adjusts stock on the active floor", async () => {
    await withFixture(async f => {
      await db.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, f.warehouse.id));
      const [active] = await db.insert(warehouses).values({ name: randomUUID(), address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
      try {
        const [stock] = await db.insert(materialStock).values({ warehouseId: active.id, chemicalId: f.chemical.id, quantity: "4" }).returning();
        await expect(invoke(addStockFn, purchaseData(f, "chemical", true), f.actor.id)).rejects.toThrow("inactive");
        await invoke(adjustStockFn, { materialType: "chemical", materialId: f.chemical.id, lotId: f.lots.chemical.id, adjustment: 1, reason: "Active floor recount" }, f.actor.id);
        expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, stock.id) }))?.quantity).toBe("5.000");
        expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, material(f, "chemical").stock.id) }))?.quantity).toBe("10.000");
        expect(await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.warehouseId, active.id))).toMatchObject([{ type: "credit", amount: "1.000" }]);
        expect(await db.select().from(purchaseRecords).where(eq(purchaseRecords.warehouseId, f.warehouse.id))).toEqual([]);
        expect((await db.query.wallets.findFirst({ where: eq(wallets.id, f.wallet.id) }))?.balance).toBe("100.00");
      } finally {
        await db.delete(inventoryAuditLog).where(eq(inventoryAuditLog.warehouseId, active.id));
        await db.delete(materialStock).where(eq(materialStock.warehouseId, active.id));
        await db.delete(materialLotMovements).where(eq(materialLotMovements.warehouseId, active.id));
        await db.delete(materialLotStock).where(eq(materialLotStock.warehouseId, active.id));
        await db.delete(warehouses).where(eq(warehouses.id, active.id));
      }
    });
  });

  it("rejects nonpositive, nonfinite and unrepresentable purchase quantities before finance or stock writes", async () => {
    await withFixture(async f => {
      for (const quantity of ["-1", "0", "NaN", "Infinity", "0.0001", "1000000000", ""]) {
        await expect(invoke(addStockFn, { ...purchaseData(f, "chemical", true), quantity }, f.actor.id)).rejects.toThrow();
      }
      const { stock, materialId } = material(f, "chemical");
      expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, stock.id) }))?.quantity).toBe("10.000");
      expect(await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.materialId, materialId))).toEqual([]);
      expect(await db.select().from(purchaseRecords).where(eq(purchaseRecords.warehouseId, f.warehouse.id))).toEqual([]);
      expect(await db.select().from(expenses).where(eq(expenses.walletId, f.wallet.id))).toEqual([]);
      expect((await db.query.wallets.findFirst({ where: eq(wallets.id, f.wallet.id) }))?.balance).toBe("100.00");
    });
  });

  it("rejects nonfinite and unrepresentable manual adjustments before changing stock or audit", async () => {
    await withFixture(async f => {
      const { stock, materialId, lotId } = material(f, "chemical");
      for (const adjustment of [NaN, Infinity, -Infinity, 0.0001, -0.0001, 1_000_000_000]) {
        await expect(invoke(adjustStockFn, { materialType: "chemical", materialId, lotId, adjustment, reason: "Invalid quantity" }, f.actor.id)).rejects.toThrow();
      }
      expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, stock.id) }))?.quantity).toBe("10.000");
      expect(await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.materialId, materialId))).toEqual([]);
    });
  });

  it.each(["chemical", "packaging"] as const)("serializes manual %s adjustment after a production debit", async type => {
    await withFixture(async f => {
      const { stock, materialId, lotId } = material(f, type);
      const result = await afterHeldDebit(f, type, () => invoke(adjustStockFn, { materialType: type, materialId, lotId, adjustment: 1, reason: "Returned unused material" }, f.actor.id));
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") expect(result.value).toMatchObject({ previousQty: 0, newQty: 1 });
      expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, stock.id) }))?.quantity).toBe("1.000");
      const audit = await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.materialId, materialId));
      expect(audit).toHaveLength(2);
      expect(audit.map(row => ({ type: row.type, amount: row.amount }))).toEqual(expect.arrayContaining([{ type: "debit", amount: "10.000" }, { type: "credit", amount: "1.000" }]));
    });
  });

  it.each(["chemical", "packaging"] as const)("serializes a paid %s purchase with a production debit and preserves finance records", async type => {
    await withFixture(async f => {
      const { stock, materialId } = material(f, type);
      const result = await afterHeldDebit(f, type, () => invoke(addStockFn, purchaseData(f, type, true), f.actor.id));
      expect(result.status).toBe("fulfilled");
      expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, stock.id) }))?.quantity).toBe("1.000");
      const purchases = await db.select().from(purchaseRecords).where(eq(purchaseRecords.warehouseId, f.warehouse.id));
      expect(purchases).toHaveLength(1);
      expect(purchases[0]).toMatchObject({ quantity: "1.000", cost: "10.00", paidAmount: "10.00", supplierId: f.supplier.id });
      expect(await db.select().from(supplierPayments).where(eq(supplierPayments.purchaseId, purchases[0].id))).toMatchObject([{ amount: "10.00" }]);
      expect(await db.select().from(expenses).where(eq(expenses.walletId, f.wallet.id))).toMatchObject([{ amount: "10.00", category: "Supplier Purchase" }]);
      expect(await db.select().from(transactions).where(eq(transactions.walletId, f.wallet.id))).toMatchObject([{ type: "debit", amount: "10.00", source: "Expense" }]);
      expect((await db.query.wallets.findFirst({ where: eq(wallets.id, f.wallet.id) }))?.balance).toBe("90.00");
      const audit = await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.materialId, materialId));
      expect(audit).toHaveLength(2);
      expect(audit.map(row => ({ type: row.type, amount: row.amount }))).toEqual(expect.arrayContaining([{ type: "debit", amount: "10.000" }, { type: "credit", amount: "1.000" }]));
    });
  });

  it("rejects a stale adjust debit without writing its audit after production consumed stock", async () => {
    await withFixture(async f => {
      const { stock, materialId, lotId } = material(f, "chemical");
      const result = await afterHeldDebit(f, "chemical", () =>
        invoke(adjustStockFn, { materialType: "chemical", materialId, lotId, adjustment: -1, reason: "Remove shortage" }, f.actor.id));
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.message).toMatch(/Not enough stock in this lot/);
      expect((await db.query.materialStock.findFirst({ where: eq(materialStock.id, stock.id) }))?.quantity).toBe("0.000");
      const audit = await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.materialId, materialId));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason: "Production guarded debit", amount: "10.000" });
    });
  });

  it.each(["chemical", "packaging"] as const)("serializes two first %s purchases into one stock row", async type => {
    await withFixture(async f => {
      const { stock, materialId } = material(f, type);
      await db.delete(materialStock).where(eq(materialStock.id, stock.id));
      const originalTransaction = db.transaction.bind(db);
      const acquired = deferred<number>();
      const started = [deferred<number>(), deferred<number>()];
      const release = deferred<void>();
      // A short table lock admits both real readers but holds their first INSERTs
      // until PostgreSQL confirms that both independent purchase backends are waiting.
      const holder = originalTransaction(async tx => {
        const { rows: [backend] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        await tx.execute(sql`LOCK TABLE material_stock IN SHARE MODE`);
        acquired.resolve(backend.pid);
        await release.promise;
      });
      void holder.catch(acquired.reject);
      let operations: Promise<unknown>[] = [];
      let spy: ReturnType<typeof vi.spyOn> | undefined;
      try {
        const holderPid = await acquired.promise;
        let index = 0;
        spy = vi.spyOn(db, "transaction").mockImplementation(
          ((callback: Parameters<typeof db.transaction>[0]) => {
            const signal = started[index++];
            return originalTransaction(async tx => {
              const { rows: [backend] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
              signal.resolve(backend.pid);
              return callback(tx);
            });
          }) as typeof db.transaction,
        );
        operations = started.map(signal => {
          const operation = invoke(addStockFn, purchaseData(f, type), f.actor.id);
          void operation.catch(signal.reject);
          return operation;
        });
        const pids = await Promise.all(started.map(signal => signal.promise));
        expect(new Set([holderPid, ...pids]).size).toBe(3);
        // The second purchase queues on the first one's new price lot, which itself waits on the table lock.
        for (const pid of pids) await waitForBlock([holderPid, ...pids.filter(other => other !== pid)], pid);
        release.resolve();
        const results = await Promise.allSettled(operations);
        expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
        await holder;
      } finally {
        release.resolve();
        await Promise.allSettled([holder, ...operations]);
        spy?.mockRestore();
      }
      const rows = await db.select().from(materialStock).where(and(eq(materialStock.warehouseId, f.warehouse.id),
        type === "chemical" ? eq(materialStock.chemicalId, materialId) : eq(materialStock.packagingMaterialId, materialId)));
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe("2.000");
      const purchases = await db.select().from(purchaseRecords).where(eq(purchaseRecords.warehouseId, f.warehouse.id));
      expect(purchases).toHaveLength(2);
      expect(purchases.every(row => row.quantity === "1.000" && row.paidAmount === "0.00")).toBe(true);
      const audit = await db.select().from(inventoryAuditLog).where(eq(inventoryAuditLog.materialId, materialId));
      expect(audit).toHaveLength(2);
      expect(audit.every(row => row.type === "credit" && row.amount === "1.000")).toBe(true);
      expect((await db.query.wallets.findFirst({ where: eq(wallets.id, f.wallet.id) }))?.balance).toBe("100.00");
    });
  });
});
