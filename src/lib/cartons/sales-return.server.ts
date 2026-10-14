import { and, eq, inArray, sql } from "drizzle-orm";
import { cartons, adjustmentLog, returnRecords, returnLines } from "@/db/schemas/manufacturing-schema";
import { finishedGoodsStock, recipes } from "@/db/schemas/inventory-schema";
import type { db } from "@/db";
import { deriveCartonStatus } from "./carton.guards";

import { moveOutsidePacks, outstandingOutsideDispatch } from "./outside-packs.server";
import { outsidePackMovements } from "@/db/schemas/production-schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockCartonReturnOrder(tx: Tx, orderId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('carton_return'), hashtext(${orderId}))`);
}

export async function recordSalesReturnCartons(tx: Tx, input: {
  invoiceId: string; salesReturnId: string; recipeId: string; warehouseId: string;
  units: number; good: boolean; userId: string;
}) {
  await lockCartonReturnOrder(tx, input.invoiceId);
  const recipe = await tx.query.recipes.findFirst({ where: eq(recipes.id, input.recipeId) });
  if (input.units <= 0) return;
  const outside = Math.min(input.units, await outstandingOutsideDispatch(tx, input.invoiceId, input.recipeId, true));
  if (outside > 0) {
    if (input.good) {
      await tx.insert(finishedGoodsStock).values({ warehouseId: input.warehouseId, recipeId: input.recipeId }).onConflictDoNothing();
      await moveOutsidePacks(tx, { ...input, delta: outside, referenceId: input.invoiceId, type: "RETURN_GOOD" });
    } else await tx.insert(outsidePackMovements).values({ warehouseId: input.warehouseId, recipeId: input.recipeId, referenceId: input.invoiceId, type: "RETURN_DAMAGED", delta: outside, actorId: input.userId });
  }
  if (!recipe?.cartonPackagingId || !recipe.containersPerCarton || input.units === outside) return;

  const dispatched = await tx.select({
    cartonId: sql<string>`coalesce(${adjustmentLog.relatedCartonId}, ${adjustmentLog.cartonId})`,
    units: sql<string>`-SUM(${adjustmentLog.delta})`,
  }).from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id))
    .where(and(eq(adjustmentLog.dispatchOrderId, input.invoiceId), eq(cartons.recipeId, input.recipeId),
      inArray(adjustmentLog.type, ["DISPATCH_FULL", "DISPATCH_PARTIAL", "INVOICE_REVERSAL"])))
    .groupBy(sql`coalesce(${adjustmentLog.relatedCartonId}, ${adjustmentLog.cartonId})`)
    .having(sql`-sum(${adjustmentLog.delta}) > 0`)
    .orderBy(sql`coalesce(${adjustmentLog.relatedCartonId}, ${adjustmentLog.cartonId})`);
  const priorReturns = await tx.select().from(adjustmentLog).where(and(
    eq(adjustmentLog.dispatchOrderId, input.invoiceId), inArray(adjustmentLog.type, ["RETURN_GOOD", "RETURN_DAMAGED"]),
  ));
  const returnedBySource = new Map<string, number>();
  for (const entry of priorReturns) {
    const source = entry.relatedCartonId ?? entry.cartonId;
    returnedBySource.set(source, (returnedBySource.get(source) ?? 0) + entry.delta);
  }
  const sources = dispatched.length ? await tx.select().from(cartons)
    .where(inArray(cartons.id, dispatched.map(row => row.cartonId))).orderBy(cartons.id).for("update") : [];
  const [record] = await tx.insert(returnRecords).values({
    dispatchOrderId: input.invoiceId, returnedBy: input.userId, notes: `Sales return ${input.salesReturnId}`,
  }).returning();

  let remaining = input.units - outside;
  for (const entry of dispatched) {
    const source = sources.find(carton => carton.id === entry.cartonId)!;
    const available = Number(entry.units) - (returnedBySource.get(source.id) ?? 0);
    let fromSource = Math.min(remaining, available);
    if (fromSource <= 0) continue;
    while (fromSource > 0) {
      const units = Math.min(fromSource, source.capacity);
      let destination = source;
      let before = source.currentPacks;
      if (input.good) {
        const canRestore = source.warehouseId === input.warehouseId &&
          ["PARTIAL", "COMPLETE", "DISPATCHED"].includes(source.status) && source.currentPacks + units <= source.capacity;
        if (canRestore) {
          const [restored] = await tx.update(cartons).set({
            currentPacks: source.currentPacks + units,
            status: deriveCartonStatus(source.currentPacks + units, source.capacity),
            dispatchedAt: null, dispatchOrderId: null,
          }).where(eq(cartons.id, source.id)).returning();
          destination = restored;
          Object.assign(source, restored);
        } else {
          before = 0;
          const [created] = await tx.insert(cartons).values({
            recipeId: input.recipeId, warehouseId: input.warehouseId,
            productionRunId: source.productionRunId, packagingAllocationId: source.packagingAllocationId,
            sku: source.sku, capacity: source.capacity, currentPacks: units, status: deriveCartonStatus(units, source.capacity),
          }).returning();
          destination = created;
        }
      }
      await tx.insert(adjustmentLog).values({
        cartonId: destination.id, relatedCartonId: source.id,
        batchId: source.productionRunId, packagingAllocationId: source.packagingAllocationId, sku: source.sku,
        type: input.good ? "RETURN_GOOD" : "RETURN_DAMAGED",
        packsBefore: before, delta: units, packsAfter: input.good ? destination.currentPacks : before,
        reason: `Sales return ${input.salesReturnId}`, dispatchOrderId: input.invoiceId,
        returnRecordId: record.id, performedBy: input.userId,
      });
      await tx.insert(returnLines).values({ returnRecordId: record.id, cartonId: source.id,
        packsReturned: units, condition: input.good ? "GOOD" : "DAMAGED",
        destinationCartonId: input.good ? destination.id : null });
      remaining -= units;
      fromSource -= units;
    }
    if (remaining === 0) break;
  }
  if (remaining > 0) throw new Error("Returned packs exceed the remaining carton dispatch for this invoice");
}
