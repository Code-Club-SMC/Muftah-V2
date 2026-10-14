import { db } from "@/db";
import { cartons, adjustmentLog, productionRuns } from "@/db";
import { eq, inArray, sql, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { CartonStatus, AdjustmentType } from "./carton.types";
import { MIN_YIELD_THRESHOLD } from "./carton.types";
import {
  assertCanRemove,
  assertCanTopUp,
  assertCartonIsEditable,
  assertNewCapacityValid,
  assertNotDispatched,
  assertSameSku,
  deriveCartonStatus,
} from "./carton.guards";
import {
  BatchClosedError,
  BatchNotClosedError,
  CapacityExceededError,
  CartonAlreadyDispatchedError,
  CartonLockedError,
  CartonNotFoundError,
  CartonOnHoldError,
  PermissionError,
  YieldShortfallError,
} from "./carton.errors";
import * as repo from "./carton.repository";
import { adjustCartonStock } from "./stock-adjustment.server";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { packagingAllocations } from "@/db/schemas/production-schema";

// ---------------------------------------------------------------------------
// Scenario 1 — Top-Up a Partial Carton
// ---------------------------------------------------------------------------

export async function topUpCarton(
  cartonId: string,
  delta: number,
  userId: string,
  reason?: string,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);
    assertCanTopUp(carton, delta);

    const packsAfter = carton.currentPacks + delta;
    const newStatus = deriveCartonStatus(
      packsAfter,
      carton.capacity,
    );

    const [updated] = await tx
      .update(cartons)
      .set({
        currentPacks: packsAfter,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "TOP_UP" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta,
      packsAfter,
      reason: reason ?? null,
      performedBy: userId,
      performedAt: new Date(),
    });

    await adjustCartonStock(tx, carton, delta, userId, carton.id);
    return { carton: updated, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Scenario 2 — Remove Packs from a Carton
// ---------------------------------------------------------------------------

export async function removePacksFromCarton(
  cartonId: string,
  delta: number,
  userId: string,
  reason: string,
  notes?: string,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);
    assertCanRemove(carton, delta);

    // If SEALED, unseal first
    if (carton.status === "SEALED") {
      await tx.insert(adjustmentLog).values({
        id: createId(),
        cartonId,
        batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
        sku: carton.sku,
        type: "UNSEALED" as AdjustmentType,
        packsBefore: carton.currentPacks,
        delta: 0,
        packsAfter: carton.currentPacks,
        reason: "Unsealed by pack removal",
        performedBy: userId,
        performedAt: new Date(),
      });
    }

    const negativeDelta = -delta;
    const packsAfter = carton.currentPacks + negativeDelta;
    const newStatus = deriveCartonStatus(
      packsAfter,
      carton.capacity,
    );

    const [updated] = await tx
      .update(cartons)
      .set({
        currentPacks: packsAfter,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "REMOVAL" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta: negativeDelta,
      packsAfter,
      reason: `${reason}${notes ? `: ${notes}` : ""}`,
      performedBy: userId,
      performedAt: new Date(),
    });

    await adjustCartonStock(tx, carton, -delta, userId, carton.id);
    return { carton: updated };
  });
}

// ---------------------------------------------------------------------------
// Scenario 3 — Set Carton to an Exact Pack Count (Manual Override)
// ---------------------------------------------------------------------------

export async function setCartonCount(
  cartonId: string,
  newCount: number,
  userId: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);

    if (newCount === carton.currentPacks) {
      return { carton, changed: false };
    }

    if (newCount < 0 || newCount > carton.capacity) {
      throw new CapacityExceededError(
        `Count must be between 0 and ${carton.capacity}.`,
      );
    }

    assertCartonIsEditable(carton);

    const delta = newCount - carton.currentPacks;
    const newStatus = deriveCartonStatus(
      newCount,
      carton.capacity,
    );

    const [updated] = await tx
      .update(cartons)
      .set({
        currentPacks: newCount,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "MANUAL_OVERRIDE" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta,
      packsAfter: newCount,
      reason,
      performedBy: userId,
      performedAt: new Date(),
    });

    await adjustCartonStock(tx, carton, delta, userId, carton.id);
    return { carton: updated, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Scenario 4 — Bulk Adjust Multiple Cartons
// ---------------------------------------------------------------------------

export async function bulkAdjustCartons(
  cartonIds: string[],
  delta: number,
  strategy: "SKIP" | "CAP",
  reason: string,
  userId: string,
) {
  const bulkOperationId = createId();

  return db.transaction(async (tx) => {
    const sortedIds = [...cartonIds].sort();
    const lockedCartons = await repo.findCartonsByIdsForUpdate(sortedIds, tx);

    const updated: Array<{
      cartonId: string;
      packsBefore: number;
      packsAfter: number;
    }> = [];
    const skipped: Array<{ cartonId: string; reason: string }> = [];

    for (const carton of lockedCartons) {
      try {
        await tx.transaction(async (tx) => {
        assertCartonIsEditable(carton);

        let effectiveDelta = delta;
        if (delta > 0) {
          const available = carton.capacity - carton.currentPacks;
          if (strategy === "SKIP" && delta > available) {
            skipped.push({
              cartonId: carton.id,
              reason: "CAPACITY_EXCEEDED",
            });
            return;
          }
          if (strategy === "CAP") {
            effectiveDelta = Math.min(delta, available);
            if (effectiveDelta === 0) {
              skipped.push({
                cartonId: carton.id,
                reason: "CAPACITY_EXCEEDED",
              });
              return;
            }
          }
        } else {
          const maxRemovable = carton.currentPacks;
          if (strategy === "SKIP" && Math.abs(delta) > maxRemovable) {
            skipped.push({
              cartonId: carton.id,
              reason: "INSUFFICIENT_PACKS",
            });
            return;
          }
          if (strategy === "CAP") {
            effectiveDelta = Math.max(delta, -maxRemovable);
            if (effectiveDelta === 0) {
              skipped.push({
                cartonId: carton.id,
                reason: "INSUFFICIENT_PACKS",
              });
              return;
            }
          }
        }

        const packsAfter = carton.currentPacks + effectiveDelta;
        const newStatus = deriveCartonStatus(
          packsAfter,
          carton.capacity,
        );

        await tx
          .update(cartons)
          .set({
            currentPacks: packsAfter,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(cartons.id, carton.id));

        await tx.insert(adjustmentLog).values({
          id: createId(),
          cartonId: carton.id,
          batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
          sku: carton.sku,
          type: "BULK_ADJUST" as AdjustmentType,
          packsBefore: carton.currentPacks,
          delta: effectiveDelta,
          packsAfter,
          reason,
          bulkOperationId,
          performedBy: userId,
          performedAt: new Date(),
        });

        await adjustCartonStock(tx, carton, effectiveDelta, userId, carton.id);
        updated.push({
          cartonId: carton.id,
          packsBefore: carton.currentPacks,
          packsAfter,
        });
        });
      } catch (error) {
        skipped.push({
          cartonId: carton.id,
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
      }
    }

    return { bulkOperationId, updated, skipped };
  });
}

// ---------------------------------------------------------------------------
// Scenario 6 — Merge Packs from Multiple Partial Cartons into One
// ---------------------------------------------------------------------------

export async function mergeCartons(
  sourceCartonIds: string[],
  destinationCartonId: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
    if (sourceCartonIds.includes(destinationCartonId) || new Set(sourceCartonIds).size !== sourceCartonIds.length) throw new Error("Merge sources must be unique and different from the destination");
    const allIds = [...sourceCartonIds, destinationCartonId].sort();
    const lockedCartons = await repo.findCartonsByIdsForUpdate(allIds, tx);

    const cartonMap = new Map(lockedCartons.map((c) => [c.id, c]));
    const destination = cartonMap.get(destinationCartonId);
    if (!destination) throw new CartonNotFoundError(destinationCartonId);

    assertCartonIsEditable(destination);

    const sources = sourceCartonIds
      .map((id) => cartonMap.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (sources.length !== sourceCartonIds.length) {
      throw new CartonNotFoundError("One or more source cartons not found");
    }

    for (const source of sources) {
      assertCartonIsEditable(source);
      assertSameSku(source, destination);
      if (source.recipeId !== destination.recipeId) throw new Error("Cannot merge different recipes");
    }

    const totalSourcePacks = sources.reduce(
      (sum, s) => sum + s!.currentPacks,
      0,
    );
    const availableSpace = destination.capacity - destination.currentPacks;
    if (totalSourcePacks > availableSpace) {
      throw new CapacityExceededError(
        `Total packs (${totalSourcePacks}) exceed available space (${availableSpace}).`,
      );
    }

    // Archive all source cartons
    for (const source of sources) {
      await tx
        .update(cartons)
        .set({
          currentPacks: 0,
          status: "ARCHIVED" as CartonStatus,
          updatedAt: new Date(),
        })
        .where(eq(cartons.id, source!.id));

      await tx.insert(adjustmentLog).values({
        id: createId(),
        cartonId: source!.id,
        batchId: source!.productionRunId,
        packagingAllocationId: source!.packagingAllocationId,
        sku: source!.sku,
        type: "MERGE_OUT" as AdjustmentType,
        packsBefore: source!.currentPacks,
        delta: -source!.currentPacks,
        packsAfter: 0,
        reason: `Merged into carton ${destinationCartonId}`,
        relatedCartonId: destinationCartonId,
        performedBy: userId,
        performedAt: new Date(),
      });
    }

    // Add packs to destination
    const newPacks = destination.currentPacks + totalSourcePacks;
    const newStatus = deriveCartonStatus(
      newPacks,
      destination.capacity,
    );

    const [updatedDest] = await tx
      .update(cartons)
      .set({
        currentPacks: newPacks,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, destinationCartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId: destinationCartonId,
      batchId: destination.productionRunId,
      packagingAllocationId: destination.packagingAllocationId,
      sku: destination.sku,
      type: "MERGE_IN" as AdjustmentType,
      packsBefore: destination.currentPacks,
      delta: totalSourcePacks,
      packsAfter: newPacks,
      reason: `Merged from ${sources.length} carton(s)`,
      performedBy: userId,
      performedAt: new Date(),
    });

    for (const source of sources) {
      if (source.warehouseId !== destination.warehouseId && source.currentPacks > 0) {
        const value = await adjustCartonStock(tx, source, -source.currentPacks, userId, source.id);
        await adjustCartonStock(tx, destination, source.currentPacks, userId, destination.id, undefined, value);
      }
    }
    return {
      destination: updatedDest,
      archivedSources: sourceCartonIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Scenario 7 — Change a Carton's Capacity (Repack)
// ---------------------------------------------------------------------------

export async function repackCarton(
  cartonId: string,
  newCapacity: number,
  justification: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);
    assertCartonIsEditable(carton);
    assertNewCapacityValid(carton, newCapacity);

    const oldCapacity = carton.capacity;

    // One-time snapshot of original capacity
    const originalCapacity = carton.originalCapacity ?? oldCapacity;

    const newStatus = deriveCartonStatus(
      carton.currentPacks,
      newCapacity,
    );

    const [updated] = await tx
      .update(cartons)
      .set({
        capacity: newCapacity,
        originalCapacity,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "REPACK" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta: 0,
      packsAfter: carton.currentPacks,
      reason: `Capacity changed from ${oldCapacity} to ${newCapacity}. Justification: ${justification}`,
      performedBy: userId,
      performedAt: new Date(),
    });

    return { carton: updated };
  });
}

// ---------------------------------------------------------------------------
// Scenario 8 — Retire / Archive a Damaged or Lost Carton
// ---------------------------------------------------------------------------

export async function retireCarton(
  cartonId: string,
  reason: string,
  notes: string | undefined,
  userId: string,
  isPrivilegedUser: boolean,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);

    if (carton.status === "RETIRED") {
      throw new CartonNotFoundError(`Carton ${cartonId} is already retired.`);
    }
    if (carton.status === "DISPATCHED") {
      throw new CartonAlreadyDispatchedError(
        `Carton ${cartonId} is dispatched. Use the Returns flow.`,
      );
    }

    // COMPLETE or SEALED requires Admin (isPrivilegedUser)
    if (["COMPLETE", "SEALED"].includes(carton.status) && !isPrivilegedUser) {
      throw new PermissionError(
        "Only administrators can retire COMPLETE or SEALED cartons.",
      );
    }

    const writeOffPacks = carton.currentPacks;

    const [updated] = await tx
      .update(cartons)
      .set({
        currentPacks: 0,
        status: "RETIRED" as CartonStatus,
        retiredAt: new Date(),
        retiredReason: `${reason}${notes ? `: ${notes}` : ""}`,
        retiredBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "RETIRE" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta: -writeOffPacks,
      packsAfter: 0,
      reason: `Retired: ${reason}${notes ? `. ${notes}` : ""}`,
      performedBy: userId,
      performedAt: new Date(),
    });

    await adjustCartonStock(tx, carton, -writeOffPacks, userId, carton.id);
    return { carton: updated };
  });
}

// ---------------------------------------------------------------------------
// Scenario 11 — Add Supplementary Cartons to a Batch
// ---------------------------------------------------------------------------

export async function addCartonsToBatch(
  packagingAllocationId: string,
  count: number,
  _userId: string,
  zone?: string,
) {
  return db.transaction(async (tx) => {
    const [allocation] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.id, packagingAllocationId)).for("update");
    if (!allocation) throw new Error("Packaging allocation not found");
    if (allocation.status !== "completed") throw new BatchClosedError("Complete packaging before adding replacement carton records");
    const recipe = await repo.findRecipeById(allocation.recipeId, tx);
    const capacity = allocation.formatSnapshot
      ? allocation.formatSnapshot.usesCartons ? allocation.formatSnapshot.containersPerCarton : 0
      : recipe?.cartonPackagingId ? recipe.containersPerCarton ?? 0 : 0;
    if (!recipe || capacity <= 0) throw new Error("Recipe has no carton packaging configured");
    if (!Number.isInteger(count) || count <= 0) throw new Error("Carton count must be a positive whole number");
    const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(cartons)
      .where(and(eq(cartons.packagingAllocationId, allocation.id), sql`${cartons.status} NOT IN ('ARCHIVED', 'RETIRED')`));
    const targetCartons = allocation.packingReceiptId
      ? (allocation.fullCartonsRecorded ?? 0) + Number((allocation.partialPacksRecorded ?? 0) > 0)
      : Math.ceil((allocation.completedContainers ?? 0) / capacity);
    const shortfall = Math.max(0, targetCartons - existing.count);
    if (count > shortfall) throw new BatchClosedError("Additional cartons exceed the received allocation's carton count");
    const created = await tx.insert(cartons).values(Array.from({ length: count }, () => ({
      recipeId: recipe.id, packagingAllocationId: allocation.id, warehouseId: allocation.warehouseId,
      sku: recipe.name, capacity, currentPacks: 0, status: "PARTIAL" as const, zone: zone ?? null,
    }))).returning();
    return { created, exceedsTarget: false, totalCartons: existing.count + count, shortfallCartons: shortfall - count };
  });
}

// ---------------------------------------------------------------------------
// Scenario 13 — Transfer Packs Between Cartons
// ---------------------------------------------------------------------------

export async function transferPacks(
  sourceCartonId: string,
  destinationCartonId: string,
  packCount: number,
  userId: string,
) {
  return db.transaction(async (tx) => {
    if (sourceCartonId === destinationCartonId) throw new Error("Source and destination must be different cartons");
    const locked = await repo.findCartonsByIdsForUpdate([sourceCartonId, destinationCartonId], tx);
    const source = locked.find(carton => carton.id === sourceCartonId);
    const destination = locked.find(carton => carton.id === destinationCartonId);
    if (!source) throw new CartonNotFoundError(sourceCartonId);
    if (!destination) throw new CartonNotFoundError(destinationCartonId);
    if (source.recipeId !== destination.recipeId) throw new Error("Cannot transfer across different recipes");

    assertCartonIsEditable(source);
    assertCartonIsEditable(destination);
    assertSameSku(source, destination);

    if (packCount > source.currentPacks) {
      throw new CapacityExceededError(
        `Cannot transfer ${packCount} packs. Source only has ${source.currentPacks}.`,
      );
    }

    const destAvail = destination.capacity - destination.currentPacks;
    if (packCount > destAvail) {
      throw new CapacityExceededError(
        `Cannot transfer ${packCount} packs. Destination only has ${destAvail} space available.`,
      );
    }

    // Update source
    const sourcePacksAfter = source.currentPacks - packCount;
    const sourceNewStatus = deriveCartonStatus(
      sourcePacksAfter,
      source.capacity,
    );

    await tx
      .update(cartons)
      .set({
        currentPacks: sourcePacksAfter,
        status: sourceNewStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, sourceCartonId));

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId: sourceCartonId,
      batchId: source.productionRunId,
      packagingAllocationId: source.packagingAllocationId,
      sku: source.sku,
      type: "TRANSFER_OUT" as AdjustmentType,
      packsBefore: source.currentPacks,
      delta: -packCount,
      packsAfter: sourcePacksAfter,
      reason: `Transferred ${packCount} pack(s) to carton ${destinationCartonId}`,
      relatedCartonId: destinationCartonId,
      performedBy: userId,
      performedAt: new Date(),
    });

    // Update destination
    const destPacksAfter = destination.currentPacks + packCount;
    const destNewStatus = deriveCartonStatus(
      destPacksAfter,
      destination.capacity,
    );

    const [updatedDest] = await tx
      .update(cartons)
      .set({
        currentPacks: destPacksAfter,
        status: destNewStatus,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, destinationCartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId: destinationCartonId,
      batchId: destination.productionRunId,
      packagingAllocationId: destination.packagingAllocationId,
      sku: destination.sku,
      type: "TRANSFER_IN" as AdjustmentType,
      packsBefore: destination.currentPacks,
      delta: packCount,
      packsAfter: destPacksAfter,
      reason: `Transferred ${packCount} pack(s) from carton ${sourceCartonId}`,
      relatedCartonId: sourceCartonId,
      performedBy: userId,
      performedAt: new Date(),
    });

    if (source.warehouseId !== destination.warehouseId) {
      const value = await adjustCartonStock(tx, source, -packCount, userId, source.id);
      await adjustCartonStock(tx, destination, packCount, userId, destination.id, undefined, value);
    }
    return { source: { id: sourceCartonId, packsAfter: sourcePacksAfter }, destination: updatedDest };
  });
}

// ---------------------------------------------------------------------------
// Scenario 17 — QC Hold
// ---------------------------------------------------------------------------

export async function applyQcHold(
  cartonId: string,
  reason: string,
  userId: string,
  expiresAt?: Date,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);

    if (carton.status === "ON_HOLD") {
      throw new CartonOnHoldError(`Carton ${cartonId} is already on hold.`);
    }
    if (["DISPATCHED", "RETIRED", "ARCHIVED"].includes(carton.status)) {
      throw new CartonLockedError(
        `Cannot hold a carton with status ${carton.status}.`,
      );
    }

    const preHoldStatus = carton.status;

    const [updated] = await tx
      .update(cartons)
      .set({
        status: "ON_HOLD" as CartonStatus,
        preHoldStatus,
        holdReason: reason,
        holdStartedAt: new Date(),
        holdExpiresAt: expiresAt ?? null,
        holdStartedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "QC_HOLD_APPLIED" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta: 0,
      packsAfter: carton.currentPacks,
      reason,
      performedBy: userId,
      performedAt: new Date(),
    });

    return { carton: updated };
  });
}

export async function releaseQcHold(
  cartonId: string,
  outcome: "CLEARED" | "CONDEMNED",
  notes: string | undefined,
  userId: string,
  isPrivilegedUser: boolean,
) {
  return db.transaction(async (tx) => {
    const carton = await repo.findCartonByIdForUpdate(cartonId, tx);

    if (carton.status !== "ON_HOLD") {
      throw new CartonNotFoundError(`Carton ${cartonId} is not on hold.`);
    }

    if (!isPrivilegedUser) {
      throw new PermissionError("Only managers can release QC holds.");
    }

    if (outcome === "CLEARED") {
      const restoredStatus = carton.preHoldStatus === "SEALED" && carton.currentPacks === carton.capacity
        ? "SEALED" : deriveCartonStatus(carton.currentPacks, carton.capacity);
      const [updated] = await tx
        .update(cartons)
        .set({
          status: restoredStatus as CartonStatus,
          preHoldStatus: null,
          holdReason: null,
          holdStartedAt: null,
          holdExpiresAt: null,
          holdStartedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(cartons.id, cartonId))
        .returning();

      await tx.insert(adjustmentLog).values({
        id: createId(),
        cartonId,
        batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
        sku: carton.sku,
        type: "QC_HOLD_CLEARED" as AdjustmentType,
        packsBefore: carton.currentPacks,
        delta: 0,
        packsAfter: carton.currentPacks,
        reason: `QC Hold cleared${notes ? `. ${notes}` : ""}`,
        performedBy: userId,
        performedAt: new Date(),
      });

      return { carton: updated };
    }

    // CONDEMNED — retire the carton
    const writeOffPacks = carton.currentPacks;
    const [updated] = await tx
      .update(cartons)
      .set({
        currentPacks: 0,
        status: "RETIRED" as CartonStatus,
        preHoldStatus: null,
        holdReason: null,
        holdStartedAt: null,
        holdExpiresAt: null,
        holdStartedBy: null,
        retiredAt: new Date(),
        retiredReason: `QC Condemned${notes ? `: ${notes}` : ""}`,
        retiredBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(cartons.id, cartonId))
      .returning();

    await tx.insert(adjustmentLog).values({
      id: createId(),
      cartonId,
      batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId,
      sku: carton.sku,
      type: "QC_HOLD_CONDEMNED" as AdjustmentType,
      packsBefore: carton.currentPacks,
      delta: -writeOffPacks,
      packsAfter: 0,
      reason: `QC Hold condemned${notes ? `. ${notes}` : ""}`,
      performedBy: userId,
      performedAt: new Date(),
    });

    await adjustCartonStock(tx, carton, -writeOffPacks, userId, carton.id);
    return { carton: updated };
  });
}

// ---------------------------------------------------------------------------
// Scenario 9 — Close a Batch
// ---------------------------------------------------------------------------

export async function closeBatch(
  packagingAllocationId: string,
  userId: string,
  acknowledgeShortfall: boolean = false,
) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.id, packagingAllocationId)).for("no key update");
    if (!current) throw new Error("Packaging allocation not found");
    let allocation = current;
    if (allocation.status === "in_progress") {
      allocation = (await completePackagingAllocationCore(tx, allocation.id, userId,
        acknowledgeShortfall ? "Shortfall acknowledged when closing allocation" : undefined)).allocation;
    }
    if (allocation.status !== "completed") throw new BatchClosedError("Allocation must be in progress or completed to close carton tracking");
    const ids = await tx.select({ id: cartons.id }).from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
    const locked = await repo.findCartonsByIdsForUpdate(ids.map(carton => carton.id), tx);
    const full = locked.filter(carton => carton.status === "COMPLETE" && carton.currentPacks === carton.capacity);
    for (const carton of full) await tx.update(cartons).set({ status: "SEALED", updatedAt: new Date() }).where(eq(cartons.id, carton.id));
    return { productionRun: allocation,
      yieldPct: allocation.targetContainers > 0 ? (allocation.completedContainers ?? 0) / allocation.targetContainers * 100 : 100,
      totalPacks: allocation.completedContainers, targetPacks: allocation.targetContainers,
      cartonsSealed: full.length, cartonsOnHold: locked.filter(carton => carton.status === "ON_HOLD").length };
  });
}

// ---------------------------------------------------------------------------
// Scenario 10 — Reopen a Closed Batch
// ---------------------------------------------------------------------------

export async function reopenBatch(
  packagingAllocationId: string,
  userId: string,
  reopenReason: string,
  force: boolean = false,
) {
  return db.transaction(async tx => {
    const [allocation] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.id, packagingAllocationId)).for("no key update");
    if (!allocation) throw new Error("Packaging allocation not found");
    if (allocation.status !== "completed") throw new BatchNotClosedError("Only completed allocations have received carton tracking to reopen");
    const ids = await tx.select({ id: cartons.id }).from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
    const locked = await repo.findCartonsByIdsForUpdate(ids.map(carton => carton.id), tx);
    const dispatched = locked.filter(carton => carton.status === "DISPATCHED");
    if (dispatched.length && !force) return { requiresForce: true, dispatchedCartonIds: dispatched.map(carton => carton.id),
      message: "Some cartons are dispatched. Confirm to unseal the remaining cartons." };
    const sealed = locked.filter(carton => carton.status === "SEALED");
    for (const carton of sealed) {
      await tx.update(cartons).set({ status: deriveCartonStatus(carton.currentPacks, carton.capacity), updatedAt: new Date() }).where(eq(cartons.id, carton.id));
      await tx.insert(adjustmentLog).values({ cartonId: carton.id, packagingAllocationId: allocation.id,
        sku: carton.sku, type: "UNSEALED", packsBefore: carton.currentPacks, delta: 0,
        packsAfter: carton.currentPacks, reason: reopenReason, performedBy: userId });
    }
    // Receiving the allocation is irreversible; unsealing cartons must not enable a second receipt.
    return { productionRun: allocation, reopenedCartons: sealed.length, lockedDispatchedCartons: dispatched.length };
  });
}
