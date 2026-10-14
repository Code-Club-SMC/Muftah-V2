import { db } from "@/db";
import { cartons, adjustmentLog } from "@/db";
import { eq, inArray } from "drizzle-orm";
import * as repo from "./carton.repository";
import { adjustCartonStock } from "./stock-adjustment.server";
import { createId } from "@paralleldrive/cuid2";
import type { CartonStatus, AdjustmentType } from "./carton.types";
import {
  assertCanRemove,
  assertCanTopUp,
  assertCartonIsEditable,
  assertNotDispatched,
  assertNewCapacityValid,
  deriveCartonStatus,
} from "./carton.guards";

export async function executeBulkOperation(
  operationType: "RETIRE" | "TOP_UP" | "REMOVE" | "OVERRIDE" | "REPACK" | "QC_HOLD" | "RELEASE_HOLD",
  cartonIds: string[],
  payload: any,
  userId: string
) {
  return db.transaction(async (tx) => {
    const bulkOperationId = createId();
    const results: string[] = [];

    const targetCartons = await repo.findCartonsByIdsForUpdate(cartonIds, tx);

    if (targetCartons.length === 0) {
      throw new Error("No valid cartons found for the bulk operation.");
    }

    for (const carton of targetCartons) {
      let packsAfter = carton.currentPacks;
      let statusAfter = carton.status as CartonStatus;
      let adjType: AdjustmentType = "BULK_ADJUST";
      let delta = 0;
      let reason = payload?.reason || payload?.notes || payload?.justification || `Bulk ${operationType}`;

      if (operationType === "RETIRE") {
        assertNotDispatched(carton);
        statusAfter = "RETIRED";
        packsAfter = 0;
        delta = -carton.currentPacks;
        adjType = "RETIRE";
      } else if (operationType === "TOP_UP") {
        delta = payload.delta || 0;
        assertCanTopUp(carton, delta);
        packsAfter = carton.currentPacks + delta;
        statusAfter = deriveCartonStatus(packsAfter, carton.capacity);
        adjType = "TOP_UP";
      } else if (operationType === "REMOVE") {
        delta = payload.delta || 0;
        assertCanRemove(carton, delta);
        packsAfter = carton.currentPacks - delta;
        statusAfter = deriveCartonStatus(packsAfter, carton.capacity);
        adjType = "REMOVAL";
        delta = -delta; // Log as negative
      } else if (operationType === "OVERRIDE") {
        packsAfter = payload.newCount !== undefined ? payload.newCount : carton.currentPacks;
        if (packsAfter < 0 || packsAfter > carton.capacity) {
          throw new Error(`Invalid pack count for carton ${carton.id}.`);
        }
        assertCartonIsEditable(carton);
        delta = packsAfter - carton.currentPacks;
        statusAfter = deriveCartonStatus(packsAfter, carton.capacity);
        adjType = "MANUAL_OVERRIDE";
      } else if (operationType === "REPACK") {
        const newCapacity = payload.newCapacity || carton.capacity;
        assertNewCapacityValid(carton, newCapacity);
        assertCartonIsEditable(carton);
        statusAfter = deriveCartonStatus(carton.currentPacks, newCapacity);
        adjType = "MANUAL_OVERRIDE";
        
        await tx
          .update(cartons)
          .set({
            capacity: newCapacity,
            status: statusAfter,
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, carton.id));
      } else if (operationType === "QC_HOLD") {
        assertCartonIsEditable(carton);
        statusAfter = "ON_HOLD";
        adjType = "QC_HOLD_APPLIED";
        
        await tx
          .update(cartons)
          .set({
            status: statusAfter,
            holdReason: payload.reason || "QC Hold",
            holdStartedAt: new Date(),
            holdStartedBy: userId,
            preHoldStatus: carton.status,
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, carton.id));
      } else if (operationType === "RELEASE_HOLD") {
        if (carton.status !== "ON_HOLD") {
          throw new Error(`Carton ${carton.id} is not on QC hold.`);
        }
        statusAfter = payload.outcome === "CLEARED"
          ? (carton.preHoldStatus === "SEALED" && carton.currentPacks === carton.capacity ? "SEALED" : deriveCartonStatus(carton.currentPacks, carton.capacity))
          : "RETIRED";
        adjType = payload.outcome === "CLEARED" ? "QC_HOLD_CLEARED" : "QC_HOLD_CONDEMNED";
        if (payload.outcome !== "CLEARED") { packsAfter = 0; delta = -carton.currentPacks; }
        await tx
          .update(cartons)
          .set({
            status: statusAfter,
            currentPacks: packsAfter,
            holdReason: null,
            holdStartedAt: null,
            holdExpiresAt: null,
            holdStartedBy: null,
            preHoldStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, carton.id));
      }

      if (["RETIRE", "TOP_UP", "REMOVE", "OVERRIDE"].includes(operationType)) {
        await tx
          .update(cartons)
          .set({
            currentPacks: packsAfter,
            status: statusAfter,
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, carton.id));
      }

      await tx.insert(adjustmentLog).values({
        id: createId(),
        cartonId: carton.id,
        batchId: carton.productionRunId,
        packagingAllocationId: carton.packagingAllocationId,
        sku: carton.sku,
        type: adjType,
        packsBefore: carton.currentPacks,
        delta,
        packsAfter,
        reason,
        performedBy: userId,
        performedAt: new Date(),
        bulkOperationId,
      });

      await adjustCartonStock(tx, carton, delta, userId, carton.id);
      results.push(carton.id);
    }

    return { success: true, bulkOperationId, affected: results.length };
  });
}
