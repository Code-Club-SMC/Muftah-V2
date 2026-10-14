import { db } from "@/db";
import {
  cartons,
  adjustmentLog,
  stockCountLines,
  stockCountSessions,
  integrityAlerts,
  returnRecords,
  returnLines,
} from "@/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { AdjustmentType } from "./carton.types";
import { TOLERANCE_PACKS, TOLERANCE_PCT } from "./carton.types";
import { assertCartonIsEditable } from "./carton.guards";
import { CartonAlreadyDispatchedError, CartonLockedError, InsufficientPacksError, StockCountError } from "./carton.errors";
import * as repo from "./carton.repository";
import { adjustCartonStock } from "./stock-adjustment.server";
import { lockCartonReturnOrder } from "./sales-return.server";
import { deriveCartonStatus } from "./carton.guards";

// ---------------------------------------------------------------------------
// Scenario 9-10 (batch close/reopen) — See carton.service.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenarios 14 & 15 — Dispatch (Partial and Full)
// ---------------------------------------------------------------------------

export async function dispatchCartons(
  lines: Array<{ cartonId: string; packsToDispatch: number }>,
  orderId: string | undefined,
  userId: string,
) {
  return db.transaction(async (tx) => {
    if (orderId) await lockCartonReturnOrder(tx, orderId);
    const results: Array<{
      cartonId: string;
      packsDispatched: number;
      dispatchType: "DISPATCH_PARTIAL" | "DISPATCH_FULL";
      newStatus: string;
    }> = [];

    const locked = await repo.findCartonsByIdsForUpdate(lines.map(line => line.cartonId), tx);
    for (const line of lines) {
      const carton = locked.find(carton => carton.id === line.cartonId);
      if (!carton) throw new Error("Dispatch carton not found");
      if (!Number.isInteger(line.packsToDispatch) || line.packsToDispatch <= 0) throw new Error("Dispatch quantity must be a positive whole number");

      if (!["PARTIAL", "COMPLETE", "SEALED"].includes(carton.status)) {
        throw new CartonAlreadyDispatchedError(
          `Carton ${line.cartonId} has status ${carton.status} and cannot be dispatched.`,
        );
      }

      if (line.packsToDispatch > carton.currentPacks) {
        throw new InsufficientPacksError(
          `Cannot dispatch ${line.packsToDispatch} packs. Carton ${line.cartonId} only has ${carton.currentPacks}.`,
        );
      }

      // If sealed and partial dispatch, unseal first
      if (carton.status === "SEALED" && line.packsToDispatch < carton.currentPacks) {
        await tx.insert(adjustmentLog).values({
          id: createId(),
          cartonId: carton.id,
          batchId: carton.productionRunId,
          packagingAllocationId: carton.packagingAllocationId,
          sku: carton.sku,
          type: "UNSEALED" as AdjustmentType,
          packsBefore: carton.currentPacks,
          delta: 0,
          packsAfter: carton.currentPacks,
          reason: "Unsealed for partial dispatch",
          performedBy: userId,
          performedAt: new Date(),
        });
      }

      const originalPacks = carton.currentPacks;
      const packsAfter = originalPacks - line.packsToDispatch;
      const isFull = line.packsToDispatch === originalPacks;

      const dispatchType: AdjustmentType = isFull
        ? "DISPATCH_FULL"
        : "DISPATCH_PARTIAL";

      const newStatus = isFull ? "DISPATCHED" : "PARTIAL";

      const setFields: Partial<typeof cartons.$inferInsert> = {
        currentPacks: packsAfter,
        status: newStatus,
        updatedAt: new Date(),
      };

      if (isFull) {
        setFields.dispatchedAt = new Date();
        setFields.dispatchOrderId = orderId ?? null;
      }

      await tx
        .update(cartons)
        .set(setFields)
        .where(eq(cartons.id, carton.id));

      await tx.insert(adjustmentLog).values({
        id: createId(),
        cartonId: carton.id,
        batchId: carton.productionRunId,
        packagingAllocationId: carton.packagingAllocationId,
        sku: carton.sku,
        type: dispatchType,
        packsBefore: originalPacks,
        delta: -line.packsToDispatch,
        packsAfter,
        reason: isFull ? "Full dispatch" : `Partial dispatch: ${line.packsToDispatch} of ${originalPacks}`,
        dispatchOrderId: orderId ?? null,
        performedBy: userId,
        performedAt: new Date(),
      });

      await adjustCartonStock(tx, carton, -line.packsToDispatch, userId, carton.id);
      Object.assign(carton, setFields);
      results.push({
        cartonId: carton.id,
        packsDispatched: line.packsToDispatch,
        dispatchType,
        newStatus,
      });
    }

    return { results };
  });
}

// ---------------------------------------------------------------------------
// Scenario 16 — Return of Dispatched Packs
// ---------------------------------------------------------------------------

export async function processReturn(
  dispatchOrderId: string,
  lines: Array<{
    cartonId: string;
    packsReturned: number;
    condition: "GOOD" | "DAMAGED";
    destinationCartonId?: string;
  }>,
  notes: string | undefined,
  userId: string,
) {
  return db.transaction(async (tx) => {
    await lockCartonReturnOrder(tx, dispatchOrderId);
    const locked = await repo.findCartonsByIdsForUpdate(lines.flatMap(line => [line.cartonId, ...(line.destinationCartonId ? [line.destinationCartonId] : [])]), tx);
    const [returnRecord] = await tx.insert(returnRecords).values({ dispatchOrderId, returnedBy: userId, notes: notes ?? null }).returning();
    const results: Array<{ cartonId: string; condition: string; packsReturned: number; outcome: string }> = [];
    for (const line of lines) {
      const source = locked.find(carton => carton.id === line.cartonId);
      if (!source) throw new Error("Return source carton not found");
      if (!Number.isInteger(line.packsReturned) || line.packsReturned <= 0) throw new Error("Return quantity must be a positive whole number");
      const [dispatched] = await tx.select({ units: sql<string>`COALESCE(-SUM(${adjustmentLog.delta}), 0)` }).from(adjustmentLog)
        .where(and(sql`coalesce(${adjustmentLog.relatedCartonId}, ${adjustmentLog.cartonId}) = ${source.id}`, eq(adjustmentLog.dispatchOrderId, dispatchOrderId),
          inArray(adjustmentLog.type, ["DISPATCH_FULL", "DISPATCH_PARTIAL", "INVOICE_REVERSAL"])));
      const [returned] = await tx.select({ units: sql<string>`COALESCE(SUM(${adjustmentLog.delta}), 0)` }).from(adjustmentLog)
        .where(and(sql`COALESCE(${adjustmentLog.relatedCartonId}, ${adjustmentLog.cartonId}) = ${source.id}`,
          eq(adjustmentLog.dispatchOrderId, dispatchOrderId), inArray(adjustmentLog.type, ["RETURN_GOOD", "RETURN_DAMAGED"])));
      if (line.packsReturned > Number(dispatched.units) - Number(returned.units)) {
        throw new Error("Returned packs exceed the remaining dispatch for this carton and order");
      }
      let destination = source;
      const good = line.condition === "GOOD";
      if (good) {
        destination = line.destinationCartonId ? locked.find(carton => carton.id === line.destinationCartonId)! : source;
        if (!destination) throw new Error("Return destination carton not found");
        if (destination.id !== source.id) assertCartonIsEditable(destination);
        else if (!["PARTIAL", "COMPLETE", "DISPATCHED"].includes(source.status)) throw new Error("This carton cannot receive a return");
        if (destination.recipeId !== source.recipeId || destination.warehouseId !== source.warehouseId) {
          throw new Error("Return destination must have the same recipe and warehouse");
        }
        if (destination.currentPacks + line.packsReturned > destination.capacity) throw new Error("Returned packs exceed destination capacity");
      }
      const before = destination.currentPacks;
      const after = good ? before + line.packsReturned : before;
      if (good) {
        const [updated] = await tx.update(cartons).set({ currentPacks: after,
          status: deriveCartonStatus(after, destination.capacity), dispatchedAt: null, dispatchOrderId: null,
          updatedAt: new Date() }).where(eq(cartons.id, destination.id)).returning();
        Object.assign(destination, updated);
        await adjustCartonStock(tx, destination, line.packsReturned, userId, returnRecord.id);
      }
      await tx.insert(adjustmentLog).values({ cartonId: destination.id, relatedCartonId: source.id,
        batchId: destination.productionRunId, packagingAllocationId: destination.packagingAllocationId,
        sku: destination.sku, type: good ? "RETURN_GOOD" : "RETURN_DAMAGED",
        packsBefore: before, delta: line.packsReturned, packsAfter: after,
        reason: `Manufacturing return${notes ? `: ${notes}` : ""}`, dispatchOrderId,
        returnRecordId: returnRecord.id, performedBy: userId });
      await tx.insert(returnLines).values({ returnRecordId: returnRecord.id, cartonId: source.id,
        packsReturned: line.packsReturned, condition: line.condition, destinationCartonId: good ? destination.id : null });
      results.push({ cartonId: destination.id, condition: line.condition, packsReturned: line.packsReturned,
        outcome: good ? "added_to_carton" : "written_off" });
    }
    return { returnRecord, lines: results };
  });
}

// ---------------------------------------------------------------------------
// Scenario 18 — Physical Stock Count Reconciliation
// ---------------------------------------------------------------------------

export async function createStockCountSession(
  batchId: string | undefined,
  sku: string | undefined,
  userId: string,
  notes?: string,
) {
  return db.transaction(async (tx) => {
    const session = await repo.insertStockCountSession(
      {
        id: createId(),
        packagingAllocationId: batchId ?? null,
        sku: sku ?? null,
        status: "OPEN",
        startedBy: userId,
        notes: notes ?? null,
      },
      tx,
    );

    const conditions = [inArray(cartons.status, ["PARTIAL", "COMPLETE", "SEALED", "ON_HOLD"])];
    if (batchId) conditions.push(eq(cartons.packagingAllocationId, batchId));
    if (sku) conditions.push(eq(cartons.sku, sku));

    const batchCartons = conditions.length > 0
      ? await tx.select().from(cartons).where(and(...conditions))
      : await tx.select().from(cartons);

    if (batchCartons.length > 0 && session.id) {
      const lines = batchCartons.map((c) => ({
        id: createId(),
        sessionId: session.id,
        cartonId: c.id,
        systemCount: c.currentPacks,
        physicalCount: 0,
        delta: -c.currentPacks,
        status: "PENDING" as const,
      }));

      await tx.insert(stockCountLines).values(lines);
    }

    return session;
  });
}

export async function enterPhysicalCount(lineId: string, physicalCount: number) {
  return db.transaction(async tx => {
    const ref = await tx.query.stockCountLines.findFirst({ where: eq(stockCountLines.id, lineId) });
    if (!ref) throw new StockCountError("Line not found", "LINE_NOT_FOUND", 404);
    const [session] = await tx.select().from(stockCountSessions).where(eq(stockCountSessions.id, ref.sessionId)).for("update");
    if (!session || session.status !== "OPEN") throw new StockCountError("Only OPEN sessions accept edits", "SESSION_NOT_OPEN", 409);
    const [line] = await tx.select().from(stockCountLines).where(eq(stockCountLines.id, lineId)).for("update");
    if (!Number.isInteger(physicalCount) || physicalCount < 0) throw new Error("Physical count must be a nonnegative whole number");
    const delta = physicalCount - line.systemCount;
    const within = Math.abs(delta) <= TOLERANCE_PACKS && (line.systemCount === 0 || Math.abs(delta / line.systemCount) * 100 <= TOLERANCE_PCT);
    return tx.update(stockCountLines).set({ physicalCount, delta, status: within ? "WITHIN_TOLERANCE" : "FLAGGED" })
      .where(eq(stockCountLines.id, lineId)).returning();
  });
}

export async function submitStockCountSession(sessionId: string) {
  return db.transaction(async tx => {
    const [session] = await tx.select().from(stockCountSessions).where(eq(stockCountSessions.id, sessionId)).for("update");
    if (!session) throw new StockCountError("Session not found", "SESSION_NOT_FOUND", 404);
    if (session.status !== "OPEN") throw new StockCountError("Session is not open", "SESSION_NOT_OPEN", 409);
    const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.sessionId, sessionId));
    if (lines.some(line => line.status === "PENDING")) throw new StockCountError("All physical counts must be entered", "INCOMPLETE_COUNTS", 422);
    const [updated] = await tx.update(stockCountSessions).set({ status: "PENDING_APPROVAL" }).where(eq(stockCountSessions.id, sessionId)).returning();
    return updated;
  });
}

export async function approveStockCountSession(sessionId: string, approvedLines: Array<{ lineId: string; approved: boolean }>, userId: string) {
  return db.transaction(async tx => {
    const [session] = await tx.select().from(stockCountSessions).where(eq(stockCountSessions.id, sessionId)).for("update");
    if (!session) throw new StockCountError("Session not found", "SESSION_NOT_FOUND", 404);
    if (session.status !== "PENDING_APPROVAL") throw new StockCountError("Session is not pending approval", "SESSION_NOT_PENDING", 409);
    const sessionLines = await tx.select().from(stockCountLines).where(eq(stockCountLines.sessionId, sessionId)).orderBy(stockCountLines.id).for("update");
    const decisions = new Map(approvedLines.map(line => [line.lineId, line.approved]));
    if (decisions.size !== approvedLines.length || decisions.size !== sessionLines.length || sessionLines.some(line => !decisions.has(line.id))) {
      throw new Error("Provide exactly one decision for every stock count line");
    }
    const locked = await repo.findCartonsByIdsForUpdate(sessionLines.map(line => line.cartonId), tx);
    for (const line of sessionLines) {
      const approved = decisions.get(line.id)!;
      if (approved) {
        const carton = locked.find(carton => carton.id === line.cartonId);
        if (!carton || carton.currentPacks !== line.systemCount || ["DISPATCHED", "RETIRED", "ARCHIVED"].includes(carton.status)) {
          throw new Error("Carton stock changed during the count; start a new count session");
        }
        if (line.physicalCount < 0 || line.physicalCount > carton.capacity) throw new Error("Physical count exceeds carton capacity");
        const delta = line.physicalCount - carton.currentPacks;
        if (delta) {
          await tx.update(cartons).set({ currentPacks: line.physicalCount,
            status: carton.status === "ON_HOLD" ? "ON_HOLD" : deriveCartonStatus(line.physicalCount, carton.capacity),
            preHoldStatus: carton.status === "ON_HOLD" ? deriveCartonStatus(line.physicalCount, carton.capacity) : carton.preHoldStatus,
            updatedAt: new Date() }).where(eq(cartons.id, carton.id));
          await adjustCartonStock(tx, carton, delta, userId, sessionId);
          await tx.insert(adjustmentLog).values({ cartonId: carton.id, batchId: carton.productionRunId,
            packagingAllocationId: carton.packagingAllocationId, sku: carton.sku, type: "RECONCILIATION",
            packsBefore: carton.currentPacks, delta, packsAfter: line.physicalCount,
            reason: `Stock count reconciliation: ${line.systemCount} → ${line.physicalCount}`,
            reconciliationId: sessionId, performedBy: userId });
        }
      }
      await tx.update(stockCountLines).set({ status: approved ? "APPROVED" : "REJECTED", approvedBy: approved ? userId : null }).where(eq(stockCountLines.id, line.id));
    }
    await tx.update(stockCountSessions).set({ status: "APPROVED", approvedBy: userId, approvedAt: new Date() }).where(eq(stockCountSessions.id, sessionId));
    return { sessionId, status: "APPROVED" };
  });
}

// ---------------------------------------------------------------------------
// Scenario 19 — Integrity Check
// ---------------------------------------------------------------------------

export async function runIntegrityCheck(batchId?: string) {
  // One snapshot prevents a concurrent receipt or dispatch from producing a
  // false discrepancy between the carton, ledger and finished stock queries.
  return db.transaction(async tx => {
    const cartonFilter = batchId ? sql`AND c.packaging_allocation_id = ${batchId}` : sql``;
    const ledgerFilter = batchId ? sql`AND packaging_allocation_id = ${batchId}` : sql``;
    const result = await tx.execute(sql`
      WITH carton_totals AS (
        SELECT packaging_allocation_id, sku, SUM(current_packs) AS carton_sum
        FROM cartons AS c
        WHERE c.status NOT IN ('ARCHIVED', 'RETIRED')
          AND c.packaging_allocation_id IS NOT NULL ${cartonFilter}
        GROUP BY packaging_allocation_id, sku
      ), ledger_totals AS (
        SELECT packaging_allocation_id, sku, SUM(delta) AS ledger_total
        FROM adjustment_log
        WHERE packaging_allocation_id IS NOT NULL ${ledgerFilter}
          AND type NOT IN ('QC_HOLD_APPLIED', 'QC_HOLD_CLEARED', 'REPACK', 'UNSEALED', 'RETURN_DAMAGED')
        GROUP BY packaging_allocation_id, sku
      )
      SELECT COALESCE(ct.packaging_allocation_id, lt.packaging_allocation_id) AS packaging_allocation_id,
        COALESCE(ct.sku, lt.sku) AS sku,
        COALESCE(ct.carton_sum, 0) AS carton_sum,
        COALESCE(lt.ledger_total, 0) AS ledger_total,
        COALESCE(ct.carton_sum, 0) - COALESCE(lt.ledger_total, 0) AS delta
      FROM carton_totals ct FULL JOIN ledger_totals lt
        ON ct.packaging_allocation_id = lt.packaging_allocation_id
        AND ct.sku IS NOT DISTINCT FROM lt.sku
      WHERE COALESCE(ct.carton_sum, 0) != COALESCE(lt.ledger_total, 0)
    `);
    const mismatches = result.rows as Array<{
      packaging_allocation_id: string;
      sku: string | null;
      carton_sum: string;
      ledger_total: string;
      delta: string;
    }>;

    // Stock is shared by recipe and warehouse, so a scoped allocation check
    // reconciles all carton contents at those locations, including transfers.
    const stockFilter = batchId ? sql`AND (s.recipe_id, s.warehouse_id) IN (
      SELECT recipe_id, warehouse_id FROM packaging_allocations WHERE id = ${batchId}
      UNION SELECT recipe_id, warehouse_id FROM cartons WHERE packaging_allocation_id = ${batchId}
    )` : sql``;
    const stockResult = await tx.execute(sql`
      WITH locations AS (
        SELECT recipe_id, warehouse_id FROM finished_goods_stock
        UNION SELECT recipe_id, warehouse_id FROM cartons WHERE packaging_allocation_id IS NOT NULL
      ), stock_totals AS (
        SELECT s.recipe_id, r.name AS recipe_name, s.warehouse_id, w.name AS warehouse_name,
          r.carton_packaging_id IS NOT NULL AND COALESCE(r.containers_per_carton, 0) > 0 AS uses_cartons,
          COALESCE(f.quantity_cartons, 0) * CASE WHEN r.carton_packaging_id IS NOT NULL
            THEN COALESCE(r.containers_per_carton, 0) ELSE 0 END
            + COALESCE(f.quantity_containers, 0) AS stock_units,
          COALESCE((SELECT SUM(c.current_packs) FROM cartons c
            WHERE c.recipe_id = s.recipe_id AND c.warehouse_id = s.warehouse_id
              AND c.packaging_allocation_id IS NOT NULL
              AND c.status NOT IN ('ARCHIVED', 'RETIRED')), 0) + COALESCE(f.quantity_outside_packs, 0) AS carton_units,
          COALESCE(f.total_inventory_value, 0) AS inventory_value,
          COALESCE(f.weighted_average_cost_per_pack, 0) AS wac
        FROM locations s JOIN recipes r ON r.id = s.recipe_id
        JOIN warehouses w ON w.id = s.warehouse_id
        LEFT JOIN finished_goods_stock f ON f.recipe_id = s.recipe_id AND f.warehouse_id = s.warehouse_id
        WHERE r.formula_id IS NOT NULL ${stockFilter}
      )
      SELECT *, ROUND(stock_units * wac, 2) AS expected_value FROM stock_totals
      WHERE (uses_cartons AND stock_units != carton_units)
        OR stock_units < 0 OR inventory_value < 0 OR wac < 0
        -- WAC is stored to four decimals; allow only its half-unit rounding
        -- error per pack plus the currency column's half-cent rounding error.
        OR ABS(inventory_value - ROUND(stock_units * wac, 2)) > GREATEST(0.01, stock_units * 0.00005 + 0.005)
    `);
    const stockMismatches = stockResult.rows as Array<{
      recipe_id: string; recipe_name: string; warehouse_id: string; warehouse_name: string; uses_cartons: boolean;
      stock_units: number; carton_units: string; inventory_value: string;
      wac: string; expected_value: string;
    }>;

    for (const row of mismatches) {
      const existing = await repo.findExistingOpenAlert(row.sku ?? "", row.packaging_allocation_id, Number(row.delta), tx);
      if (!existing) {
        await tx.insert(integrityAlerts).values({
          sku: row.sku ?? "", packagingAllocationId: row.packaging_allocation_id,
          cartonSum: Number(row.carton_sum), ledgerTotal: Number(row.ledger_total),
          delta: Number(row.delta), status: "OPEN",
        });
      }
    }
    return {
      checkedAt: new Date(), mismatchCount: mismatches.length + stockMismatches.length,
      allBalanced: mismatches.length === 0 && stockMismatches.length === 0,
      mismatches, stockMismatches,
    };
  }, { isolationLevel: "repeatable read" });
}
