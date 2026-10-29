import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { batchPackingReceipts, formulas, mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { packagingMaterials, recipePackaging, recipes } from "@/db/schemas/inventory-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { authorizePacking, packingAvailability } from "./batch-packing-core.server";

export const getBatchPackingContextFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(z.object({ mixingRunId: z.string().min(1) }))
  .handler(({ data, context }) => db.transaction(async tx => {
    // Shared batch lock makes availability, receipts and request state one snapshot.
    const [run] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, data.mixingRunId)).for("share");
    if (!run) throw new Error("Mixing batch not found");
    const actor = { id: context.session.user.id, permissions: context.authContext.permissions };
    authorizePacking(actor, run.operatorId, true);
    let canRecord = run.status === "completed";
    try { authorizePacking(actor, run.operatorId); } catch { canRecord = false; }
    const [formula] = await tx.select().from(formulas).where(eq(formulas.id, run.formulaId));
    const formats = await tx.select().from(recipes).where(and(eq(recipes.formulaId, run.formulaId), eq(recipes.productId, formula.productId), eq(recipes.isActive, true))).orderBy(recipes.name);
    const receipts = await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.mixingRunId, run.id)).orderBy(desc(batchPackingReceipts.recordedAt));
    const allocations = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.mixingRunId, run.id));
    const extras = formats.length ? await tx.select().from(recipePackaging).where(inArray(recipePackaging.recipeId, formats.map(format => format.id))) : [];
    const materials = await tx.select({ id: packagingMaterials.id, name: packagingMaterials.name }).from(packagingMaterials);
    return {
      warehouseId: run.warehouseId,
      formatMaterials: formats.map(format => ({ formatId: format.id, containerPackagingId: format.containerPackagingId, cartonPackagingId: format.cartonPackagingId })),
      extras: extras.map(row => ({ recipeId: row.recipeId, packagingMaterialId: row.packagingMaterialId, quantityPerContainer: row.quantityPerContainer, usageBasis: row.usageBasis })),
      materials,
      batch: { id: run.id, batchId: run.batchId, formulaName: formula.name, bulkUnit: run.bulkUnit, producedBulk: run.actualBulkProduced ?? "0.000", availableBulk: (await packingAvailability(tx, run)).toFixed(3), canRecord },
      formats: formats.map(format => ({ id: format.id, name: format.name, fillAmount: format.fillAmount ?? "0", fillUnit: format.fillUnit ?? "", containersPerCarton: format.containersPerCarton ?? 0, usesCartons: !!format.cartonPackagingId && (format.containersPerCarton ?? 0) > 0 })),
      receipts: receipts.map(receipt => ({ id: receipt.id, requestId: receipt.requestId, recordedAt: receipt.recordedAt, totalPacks: receipt.totalPacks, bulkConsumed: receipt.bulkConsumed, lossBulk: receipt.lossBulk, lines: allocations.filter(allocation => allocation.packingReceiptId === receipt.id).map(allocation => ({ name: (allocation.formatSnapshot as { name: string }).name, fullCartons: allocation.fullCartonsRecorded ?? 0, partialPacks: allocation.partialPacksRecorded ?? 0, loosePacks: allocation.outsidePacksRecorded ?? 0, totalPacks: allocation.actualPacksProduced ?? 0, nominalBulk: allocation.nominalBulkRecorded ?? "0.000", actualBulk: allocation.actualBulkConsumed ?? "0.000" })) })),
      legacyOpenJobs: allocations.filter(allocation => !allocation.packingReceiptId && ["allocated", "in_progress"].includes(allocation.status)).length,
    };
  }));

export const getBatchPackingRequestFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(z.object({ mixingRunId: z.string().min(1), requestId: z.string().min(1) }))
  .handler(({ data, context }) => db.transaction(async tx => {
    const [run] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, data.mixingRunId)).for("share");
    if (!run) throw new Error("Mixing batch not found");
    authorizePacking({ id: context.session.user.id, permissions: context.authContext.permissions }, run.operatorId, true);
    const [receipt] = await tx.select().from(batchPackingReceipts).where(and(eq(batchPackingReceipts.mixingRunId, run.id), eq(batchPackingReceipts.requestId, data.requestId)));
    return receipt ? { status: "posted" as const, receiptId: receipt.id } : { status: "not_found" as const };
  }));
