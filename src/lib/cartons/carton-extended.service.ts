import { db } from "@/db";
import {
  cartons,
  adjustmentLog,
  stockCountLines,
  stockCountSessions,
  integrityAlerts,
} from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { AdjustmentType } from "./carton.types";
import { TOLERANCE_PACKS, TOLERANCE_PCT } from "./carton.types";
import { assertCartonIsEditable } from "./carton.guards";
import { CartonAlreadyDispatchedError, CartonLockedError, InsufficientPacksError, StockCountError } from "./carton.errors";
import * as repo from "./carton.repository";
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
    const results: Array<{
      cartonId: string;
      packsDispatched: number;
      dispatchType: "DISPATCH_PARTIAL" | "DISPATCH_FULL";
      newStatus: string;
    }> = [];

    for (const line of lines) {
      const carton = await repo.findCartonByIdForUpdate(line.cartonId, tx);

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
    const returnRecord = await repo.insertReturnRecord(
      {
        id: createId(),
        dispatchOrderId,
        returnedBy: userId,
        notes: notes ?? null,
      },
      tx,
    );

    const returnLineResults: Array<{
      cartonId: string;
      condition: string;
      packsReturned: number;
      outcome: string;
    }> = [];

    for (const line of lines) {
      const carton = await repo.findCartonByIdForUpdate(line.cartonId, tx);

      if (line.condition === "GOOD") {
        if (
          carton.status === "DISPATCHED" &&
          (carton.currentPacks === 0 || line.packsReturned === carton.currentPacks)
        ) {
          // Full return — reverse dispatch
          // When currentPacks === 0: fully dispatched, all packs coming back
          // When packsReturned === currentPacks: partially dispatched, all remaining packs coming back
          const preDispatchStatus = "SEALED" as const;
          await tx
            .update(cartons)
            .set({
              currentPacks: line.packsReturned,
              status: preDispatchStatus,
              dispatchedAt: null,
              dispatchOrderId: null,
              updatedAt: new Date(),
            })
            .where(eq(cartons.id, carton.id));

          await tx.insert(adjustmentLog).values({
            id: createId(),
            cartonId: carton.id,
            batchId: carton.productionRunId,
            sku: carton.sku,
            type: "RETURN_GOOD" as AdjustmentType,
            packsBefore: 0,
            delta: line.packsReturned,
            packsAfter: line.packsReturned,
            reason: `Full return: ${line.packsReturned} packs (good condition)${notes ? `. ${notes}` : ""}`,
            dispatchOrderId,
            returnRecordId: returnRecord.id,
            performedBy: userId,
            performedAt: new Date(),
          });

          returnLineResults.push({
            cartonId: carton.id,
            condition: line.condition,
            packsReturned: line.packsReturned,
            outcome: "reversed_dispatch",
          });
        } else {
          // Partial good return — add to destination carton
          const destId = line.destinationCartonId;
          if (!destId) {
            throw new CartonLockedError(
              `Carton ${carton.id} is dispatched and cannot receive returned packs directly. Provide a destinationCartonId for the return.`,
            );
          }
          const dest = await repo.findCartonByIdForUpdate(destId, tx);
          assertCartonIsEditable(dest);

          const destPacksAfter = dest.currentPacks + line.packsReturned;
          if (destPacksAfter > dest.capacity) {
            // Can't fit in destination — create adjustment log but don't update
            // the destination carton (over-capacity is invalid)
            await tx.insert(adjustmentLog).values({
              id: createId(),
              cartonId: carton.id,
              batchId: carton.productionRunId,
              sku: carton.sku,
              type: "RETURN_GOOD" as AdjustmentType,
              packsBefore: carton.currentPacks,
              delta: line.packsReturned,
              packsAfter: carton.currentPacks,
              reason: `Good return rejected: ${line.packsReturned} packs would exceed destination capacity (${dest.currentPacks}/${dest.capacity})${notes ? `. ${notes}` : ""}`,
              dispatchOrderId,
              returnRecordId: returnRecord.id,
              performedBy: userId,
              performedAt: new Date(),
            });

            returnLineResults.push({
              cartonId: carton.id,
              condition: line.condition,
              packsReturned: line.packsReturned,
              outcome: "capacity_exceeded",
            });
          } else {
            const newStatus = deriveCartonStatus(
              destPacksAfter,
              dest.capacity,
            );

            await tx
              .update(cartons)
              .set({
                currentPacks: destPacksAfter,
                status: newStatus,
                updatedAt: new Date(),
              })
              .where(eq(cartons.id, destId));

            await tx.insert(adjustmentLog).values({
              id: createId(),
              cartonId: destId,
              batchId: dest.productionRunId,
              sku: dest.sku,
              type: "RETURN_GOOD" as AdjustmentType,
              packsBefore: dest.currentPacks,
              delta: line.packsReturned,
              packsAfter: destPacksAfter,
              reason: `Good return: ${line.packsReturned} packs${notes ? `. ${notes}` : ""}`,
              dispatchOrderId,
              returnRecordId: returnRecord.id,
              performedBy: userId,
              performedAt: new Date(),
            });

            returnLineResults.push({
              cartonId: destId,
              condition: line.condition,
              packsReturned: line.packsReturned,
              outcome: "added_to_carton",
            });
          }
        }
      } else {
        // DAMAGED — packs do not re-enter inventory
        await tx.insert(adjustmentLog).values({
          id: createId(),
          cartonId: carton.id,
          batchId: carton.productionRunId,
          sku: carton.sku,
          type: "RETURN_DAMAGED" as AdjustmentType,
          packsBefore: carton.currentPacks,
          delta: line.packsReturned,
          packsAfter: carton.currentPacks,
          reason: `Damaged return: ${line.packsReturned} packs written off as shrinkage${notes ? `. ${notes}` : ""}`,
          dispatchOrderId,
          returnRecordId: returnRecord.id,
          performedBy: userId,
          performedAt: new Date(),
        });

        returnLineResults.push({
          cartonId: carton.id,
          condition: line.condition,
          packsReturned: line.packsReturned,
          outcome: "written_off",
        });
      }
    }

    // Create return lines
    await repo.insertReturnLines(
      lines.map((line) => ({
        id: createId(),
        returnRecordId: returnRecord.id,
        cartonId: line.cartonId,
        packsReturned: line.packsReturned,
        condition: line.condition,
        destinationCartonId: line.destinationCartonId ?? null,
      })),
      tx,
    );

    return { returnRecord, lines: returnLineResults };
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
        batchId: batchId ?? null,
        sku: sku ?? null,
        status: "OPEN",
        startedBy: userId,
        notes: notes ?? null,
      },
      tx,
    );

    const conditions = [];
    if (batchId) conditions.push(eq(cartons.productionRunId, batchId));
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

export async function enterPhysicalCount(
  lineId: string,
  physicalCount: number,
) {
  const lines = await db
    .select()
    .from(stockCountLines)
    .where(eq(stockCountLines.id, lineId));
  if (!lines.length) throw new StockCountError("Line not found", "LINE_NOT_FOUND", 404);

  const line = lines[0];

  const sessionRows = await db
    .select()
    .from(stockCountSessions)
    .where(eq(stockCountSessions.id, line.sessionId));
  if (sessionRows.length && sessionRows[0].status !== "OPEN") {
    throw new StockCountError(
      `Cannot enter counts for a session with status "${sessionRows[0].status}". Only OPEN sessions accept edits.`,
      "SESSION_NOT_OPEN",
      409,
    );
  }

  const delta = physicalCount - line.systemCount;
  let status: string;

  if (Math.abs(delta) <= TOLERANCE_PACKS && (line.systemCount === 0 || Math.abs(delta / line.systemCount) * 100 <= TOLERANCE_PCT)) {
    status = "WITHIN_TOLERANCE";
  } else {
    status = "FLAGGED";
  }

  return db
    .update(stockCountLines)
    .set({ physicalCount, delta, status })
    .where(eq(stockCountLines.id, lineId))
    .returning();
}

export async function submitStockCountSession(sessionId: string) {
  const session = await repo.findStockCountSessionById(sessionId);
  if (!session) throw new StockCountError("Session not found", "SESSION_NOT_FOUND", 404);
  if (session.status !== "OPEN")
    throw new StockCountError("Session is not open", "SESSION_NOT_OPEN", 409);

  // Check all lines have physical counts
  const lines = await repo.findStockCountLinesBySessionId(sessionId);
  const unentered = lines.filter((l) => l.physicalCount === 0);
  if (unentered.length > 0) {
    throw new StockCountError(
      `${unentered.length} carton(s) still need physical counts.`,
      "INCOMPLETE_COUNTS",
      422,
    );
  }

  return repo.updateStockCountSessionById(sessionId, {
    status: "PENDING_APPROVAL",
  });
}

export async function approveStockCountSession(
  sessionId: string,
  approvedLines: Array<{ lineId: string; approved: boolean }>,
  userId: string,
) {
  const session = await repo.findStockCountSessionById(sessionId);
  if (!session) throw new StockCountError("Session not found", "SESSION_NOT_FOUND", 404);
  if (session.status !== "PENDING_APPROVAL")
    throw new StockCountError("Session is not pending approval", "SESSION_NOT_PENDING", 409);

  const sessionLines = await repo.findStockCountLinesBySessionId(sessionId);

  return db.transaction(async (tx) => {
    // Apply corrections for approved lines
    for (const { lineId, approved } of approvedLines) {
      const line = sessionLines.find((l) => l.id === lineId);
      if (!line) continue;

      if (approved && line.delta !== 0) {
        const carton = await repo.findCartonByIdForUpdate(line.cartonId, tx);
        const newPacks = line.physicalCount;
        const newStatus = deriveCartonStatus(
          newPacks,
          carton.capacity,
        );

        await tx
          .update(cartons)
          .set({
            currentPacks: newPacks,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, line.cartonId));

        await tx.insert(adjustmentLog).values({
          id: createId(),
          cartonId: line.cartonId,
          batchId: carton.productionRunId,
          sku: carton.sku,
          type: "RECONCILIATION" as AdjustmentType,
          packsBefore: carton.currentPacks,
          delta: line.delta,
          packsAfter: newPacks,
          reason: `Stock count reconciliation: ${line.systemCount} → ${line.physicalCount}`,
          reconciliationId: sessionId,
          performedBy: userId,
          performedAt: new Date(),
        });
      }

      await tx
        .update(stockCountLines)
        .set({
          status: approved ? "APPROVED" : "REJECTED",
          approvedBy: approved ? userId : null,
        })
        .where(eq(stockCountLines.id, lineId));
    }

    await repo.updateStockCountSessionById(sessionId, {
      status: "APPROVED",
      approvedBy: userId,
      approvedAt: new Date(),
    });

    return { sessionId, status: "APPROVED" };
  });
}

// ---------------------------------------------------------------------------
// Scenario 19 — Integrity Check
// ---------------------------------------------------------------------------

export async function runIntegrityCheck(batchId?: string) {
  const batchFilter = batchId
    ? sql`AND c.production_run_id = ${batchId}`
    : sql``;

  const result = await db.execute(sql`
    WITH carton_totals AS (
      SELECT
        production_run_id,
        sku,
        SUM(current_packs) AS carton_sum
      FROM cartons AS c
      WHERE c.status NOT IN ('ARCHIVED', 'RETIRED')
      ${batchFilter}
      GROUP BY production_run_id, sku
    ),
    ledger_totals AS (
      SELECT
        batch_id,
        sku,
        SUM(delta) AS ledger_total
      FROM adjustment_log
      WHERE type NOT IN ('QC_HOLD_APPLIED', 'QC_HOLD_CLEARED', 'QC_HOLD_CONDEMNED', 'REPACK', 'UNSEALED')
      GROUP BY batch_id, sku
    )
    SELECT
      ct.production_run_id,
      ct.sku,
      ct.carton_sum,
      COALESCE(lt.ledger_total, 0) AS ledger_total,
      ct.carton_sum - COALESCE(lt.ledger_total, 0) AS delta
    FROM carton_totals ct
    LEFT JOIN ledger_totals lt
      ON ct.production_run_id = lt.batch_id
     AND ct.sku = lt.sku
    WHERE ct.carton_sum != COALESCE(lt.ledger_total, 0)
  `);

  const mismatches = result.rows as Array<{
    production_run_id: string;
    sku: string | null;
    carton_sum: number;
    ledger_total: number;
    delta: number;
  }>;

  if (mismatches.length > 0) {
    // De-duplication: only insert if no OPEN/ACKNOWLEDGED alert exists for same sku/batch/delta
    const toInsert: (typeof integrityAlerts.$inferInsert)[] = [];
    for (const row of mismatches) {
      const existing = await repo.findExistingOpenAlert(
        row.sku ?? "",
        row.production_run_id,
        Number(row.delta),
      );
      if (!existing) {
        toInsert.push({
          id: createId(),
          sku: row.sku ?? "",
          batchId: row.production_run_id,
          cartonSum: Number(row.carton_sum),
          ledgerTotal: Number(row.ledger_total),
          delta: Number(row.delta),
          status: "OPEN",
        });
      }
    }

    if (toInsert.length > 0) {
      await db.insert(integrityAlerts).values(toInsert);
    }
  }

  return {
    checkedAt: new Date(),
    mismatchCount: mismatches.length,
    allBalanced: mismatches.length === 0,
    mismatches,
  };
}