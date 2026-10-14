import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { cartons, adjustmentLog } from "@/db/schemas/manufacturing-schema";
import { finishedGoodsStock, recipes } from "@/db/schemas/inventory-schema";
import type { invoiceItems } from "@/db/schemas/sales-schema";
import { deriveCartonStatus } from "./carton.guards";
import { adjustCartonStock } from "./stock-adjustment.server";

import { moveOutsidePacks, outstandingOutsideDispatch } from "./outside-packs.server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Caller holds finished-goods locks before this function locks individual cartons.
// Creation and editing use the same carton selection and dispatch ledger.
export async function dispatchInvoiceCartons(tx: Tx, input: {
  warehouseId: string; recipeId: string; invoiceId: string; userId: string;
  units: number; containersPerCarton: number; unitType: "carton" | "units";
  strict: boolean;
}) {
  if (input.units <= 0) return;
  const available = await tx.select().from(cartons).where(and(
    eq(cartons.warehouseId, input.warehouseId), eq(cartons.recipeId, input.recipeId),
    inArray(cartons.status, ["COMPLETE", "SEALED", "PARTIAL"]),
  )).orderBy(cartons.createdAt, cartons.id).for("update");
  const full = (carton: typeof cartons.$inferSelect) =>
    ["COMPLETE", "SEALED"].includes(carton.status) &&
    carton.capacity === input.containersPerCarton && carton.currentPacks === input.containersPerCarton;
  const sorted = input.unitType === "units" ? [
    ...available.filter(carton => carton.status === "PARTIAL"),
    ...available.filter(carton => ["COMPLETE", "SEALED"].includes(carton.status) && !full(carton)),
    ...available.filter(full),
  ] : input.strict ? available.filter(full) : [
    ...available.filter(carton => ["COMPLETE", "SEALED"].includes(carton.status)),
    ...available.filter(carton => carton.status === "PARTIAL"),
  ];
  const stock = await tx.query.finishedGoodsStock.findFirst({ where: and(eq(finishedGoodsStock.warehouseId, input.warehouseId), eq(finishedGoodsStock.recipeId, input.recipeId)) });
  const outside = !input.containersPerCarton || input.unitType === "units" || !input.strict ? Math.min(input.units, input.containersPerCarton ? stock?.quantityOutsidePacks ?? 0 : stock?.quantityContainers ?? 0) : 0;
  if (outside) await moveOutsidePacks(tx, { ...input, referenceId: input.invoiceId, type: "DISPATCH", delta: -outside });
  let remaining = input.units - outside;
  if (!input.containersPerCarton) return;
  for (const carton of sorted) {
    if (remaining === 0) break;
    const packs = Math.min(carton.currentPacks, remaining);
    if (packs <= 0) continue;
    const fullDispatch = packs === carton.currentPacks;
    if (carton.status === "SEALED" && !fullDispatch) {
      await tx.insert(adjustmentLog).values({
        cartonId: carton.id, batchId: carton.productionRunId,
        packagingAllocationId: carton.packagingAllocationId, sku: carton.sku,
        type: "UNSEALED", packsBefore: carton.currentPacks, delta: 0,
        packsAfter: carton.currentPacks, reason: "Unsealed for partial dispatch", performedBy: input.userId,
      });
    }
    await tx.update(cartons).set({
      currentPacks: carton.currentPacks - packs, status: fullDispatch ? "DISPATCHED" : "PARTIAL",
      ...(fullDispatch ? { dispatchedAt: new Date(), dispatchOrderId: input.invoiceId } : {}),
      updatedAt: new Date(),
    }).where(eq(cartons.id, carton.id));
    await tx.insert(adjustmentLog).values({
      cartonId: carton.id, batchId: carton.productionRunId,
      packagingAllocationId: carton.packagingAllocationId, sku: carton.sku,
      type: fullDispatch ? "DISPATCH_FULL" : "DISPATCH_PARTIAL",
      packsBefore: carton.currentPacks, delta: -packs, packsAfter: carton.currentPacks - packs,
      reason: fullDispatch ? "Full dispatch" : `Partial dispatch: ${packs} of ${carton.currentPacks}`,
      dispatchOrderId: input.invoiceId, performedBy: input.userId,
    });
    remaining -= packs;
  }
  if (remaining > 0) throw new Error(`Not enough pack inventory in cartons to dispatch ${input.units} units.`);
}

export async function reverseInvoiceStock(tx: Tx, input: {
  invoiceId: string; warehouseId: string; userId: string;
  items: Array<typeof invoiceItems.$inferSelect>;
  dispatchedUnits: (item: typeof invoiceItems.$inferSelect, capacity: number) => number;
}) {
  const byRecipe = new Map<string, Array<typeof invoiceItems.$inferSelect>>();
  for (const item of input.items) {
    if (item.recipeId) byRecipe.set(item.recipeId, [...(byRecipe.get(item.recipeId) ?? []), item]);
  }
  for (const [recipeId, items] of [...byRecipe].sort(([a], [b]) => a.localeCompare(b))) {
    const recipe = await tx.query.recipes.findFirst({ where: eq(recipes.id, recipeId) });
    if (!recipe) throw new Error("Invoice recipe not found");
    const capacity = recipe.cartonPackagingId ? recipe.containersPerCarton ?? 0 : 0;
    const units = items.reduce((total, item) => total + input.dispatchedUnits(item, capacity || 1), 0);
    if (!units) continue;
    const outside = await outstandingOutsideDispatch(tx, input.invoiceId, recipeId);
    if (outside) await moveOutsidePacks(tx, { warehouseId: input.warehouseId, recipeId, referenceId: input.invoiceId, type: "INVOICE_REVERSAL", delta: outside, userId: input.userId });
    if (capacity > 0) {
      // Reversal entries cancel previous dispatches while leaving their evidence
      // linked to the invoice. A later edit reverses only its current dispatch.
      const sourceId = sql<string>`coalesce(${adjustmentLog.relatedCartonId}, ${adjustmentLog.cartonId})`;
      const dispatches = await tx.select({ cartonId: sourceId, units: sql<string>`-sum(${adjustmentLog.delta})` })
        .from(adjustmentLog).innerJoin(cartons, eq(adjustmentLog.cartonId, cartons.id))
        .where(and(eq(adjustmentLog.dispatchOrderId, input.invoiceId), eq(cartons.recipeId, recipeId),
          inArray(adjustmentLog.type, ["DISPATCH_FULL", "DISPATCH_PARTIAL", "INVOICE_REVERSAL"])))
        .groupBy(sourceId).orderBy(sourceId);
      if (dispatches.reduce((total, entry) => total + Number(entry.units), 0) !== units - outside) {
        throw new Error("Invoice carton dispatch ledger does not match its dispatched units");
      }
      const sources = dispatches.length ? await tx.select().from(cartons)
        .where(inArray(cartons.id, dispatches.map(entry => entry.cartonId))).orderBy(cartons.id).for("update") : [];
      for (const entry of dispatches) {
        let remaining = Number(entry.units);
        if (remaining <= 0) continue;
        const source = sources.find(carton => carton.id === entry.cartonId)!;
        if (source.capacity <= 0) throw new Error("Invoice dispatch source carton has invalid capacity");
        while (remaining > 0) {
          const packs = Math.min(remaining, source.capacity);
          const canRestore = source.warehouseId === input.warehouseId &&
            ["PARTIAL", "COMPLETE", "DISPATCHED", "ARCHIVED"].includes(source.status) &&
            source.currentPacks + packs <= source.capacity &&
            (!source.dispatchOrderId || source.dispatchOrderId === input.invoiceId);
          const before = canRestore ? source.currentPacks : 0;
          const [destination] = canRestore
            ? await tx.update(cartons).set({ currentPacks: before + packs,
                status: deriveCartonStatus(before + packs, source.capacity),
                dispatchedAt: null, dispatchOrderId: null, updatedAt: new Date(),
              }).where(eq(cartons.id, source.id)).returning()
            : await tx.insert(cartons).values({ recipeId, warehouseId: input.warehouseId,
                productionRunId: source.productionRunId, packagingAllocationId: source.packagingAllocationId,
                sku: source.sku, capacity: source.capacity, currentPacks: packs,
                status: deriveCartonStatus(packs, source.capacity),
              }).returning();
          if (canRestore) Object.assign(source, destination);
          await tx.insert(adjustmentLog).values({
            cartonId: destination.id, relatedCartonId: source.id,
            batchId: source.productionRunId, packagingAllocationId: source.packagingAllocationId, sku: source.sku,
            type: "INVOICE_REVERSAL", packsBefore: before, delta: packs, packsAfter: before + packs,
            reason: `Invoice ${input.invoiceId} dispatch reversed`, dispatchOrderId: input.invoiceId,
            performedBy: input.userId,
          });
          remaining -= packs;
        }
      }
    }
    // Restore the historical dispatch value, then blend it with any later receipt.
    const value = items.reduce((total, item) => total.plus(item.costOfGoodsSold ?? 0), new Big(0));
    await adjustCartonStock(tx, { warehouseId: input.warehouseId, recipeId }, units,
      input.userId, input.invoiceId, value.div(units).toNumber(), value.toFixed(2));
  }
}
