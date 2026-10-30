import { and, between, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db";
import { chemicals, materialAdjustments, materialLots, packagingMaterials, products, warehouses } from "@/db/schemas/inventory-schema";
import { batchPackingReceipts, formulas, mixingMaterialUse, mixingRuns, packingMaterialUse, PRODUCTION_LOSS_LIMITS_ID, productionLossLimits } from "@/db/schemas/production-schema";
import {
  DEFAULT_LOSS_LIMITS, STORE_LOSS_REASONS, toBatchRow, toChemicalRow, toPackingRow, toPowderRow, toStoreRow,
  type LossLimits, type LossRow, type LossTab,
} from "@/lib/production/loss-report";

type Reader = Pick<typeof db, "select">;
export type LossBounds = { fromDate: Date; toDate: Date };

const runColumns = {
  runId: mixingRuns.id, batchId: mixingRuns.batchId, productId: products.id, product: products.name,
};

async function batchRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: mixingRuns.actualCompletionDate, target: mixingRuns.targetBulkQuantity, actual: mixingRuns.actualBulkProduced,
    unit: mixingRuns.bulkUnit, chemicalCost: mixingRuns.totalChemicalCost, reasonCode: mixingRuns.shortfallReasonCode, note: mixingRuns.shortfallReason,
    formulaId: formulas.id, formula: formulas.name,
  }).from(mixingRuns)
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(
      eq(mixingRuns.status, "completed"),
      sql`${mixingRuns.actualBulkProduced} < ${mixingRuns.targetBulkQuantity}`,
      between(mixingRuns.actualCompletionDate, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(mixingRuns.actualCompletionDate), desc(mixingRuns.batchId));
  return rows.map((row) => toBatchRow({ ...row, date: row.date!, actual: row.actual ?? "0", chemicalCost: row.chemicalCost ?? "0" }, limits));
}

async function chemicalRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: mixingRuns.actualCompletionDate, useId: mixingMaterialUse.id, chemicalId: chemicals.id, chemical: chemicals.name, unit: chemicals.unit,
    formula: mixingMaterialUse.formulaQuantity, used: mixingMaterialUse.usedQuantity, extraCost: mixingMaterialUse.extraCost,
    reasonCode: mixingMaterialUse.reason, note: mixingMaterialUse.note,
  }).from(mixingMaterialUse)
    .innerJoin(mixingRuns, eq(mixingRuns.id, mixingMaterialUse.mixingRunId))
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .innerJoin(chemicals, eq(chemicals.id, mixingMaterialUse.chemicalId))
    .where(and(
      eq(mixingRuns.status, "completed"),
      gt(mixingMaterialUse.extraQuantity, "0"),
      between(mixingRuns.actualCompletionDate, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(mixingRuns.actualCompletionDate), desc(mixingRuns.batchId), chemicals.name);
  return rows.map((row) => toChemicalRow({ ...row, date: row.date!, unit: row.unit ?? "kg" }, limits));
}

async function powderRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: batchPackingReceipts.packedAt, receiptId: batchPackingReceipts.id, unit: mixingRuns.bulkUnit,
    packed: batchPackingReceipts.bulkConsumed, lost: batchPackingReceipts.lossBulk, costPerUnit: mixingRuns.chemicalCostPerUnit,
    reasonCode: batchPackingReceipts.lossReasonCode, note: batchPackingReceipts.lossReason,
  }).from(batchPackingReceipts)
    .innerJoin(mixingRuns, eq(mixingRuns.id, batchPackingReceipts.mixingRunId))
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(gt(batchPackingReceipts.lossBulk, "0"), between(batchPackingReceipts.packedAt, bounds.fromDate, bounds.toDate)))
    .orderBy(desc(batchPackingReceipts.packedAt), desc(batchPackingReceipts.id));
  return rows.map((row) => toPowderRow({ ...row, costPerUnit: row.costPerUnit ?? "0" }, limits));
}

async function packingRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: batchPackingReceipts.packedAt, useId: packingMaterialUse.id, materialId: packagingMaterials.id, material: packagingMaterials.name,
    measuredInKg: packingMaterialUse.measuredInKg, needed: packingMaterialUse.neededQuantity, used: packingMaterialUse.usedQuantity,
    extraQuantity: packingMaterialUse.extraQuantity, extraCost: packingMaterialUse.extraCost, reasonCode: packingMaterialUse.reason, note: packingMaterialUse.note,
    expectedShoppers: packingMaterialUse.expectedShoppers, actualShoppers: packingMaterialUse.actualShoppers, lossShoppers: packingMaterialUse.lossShoppers,
  }).from(packingMaterialUse)
    .innerJoin(batchPackingReceipts, eq(batchPackingReceipts.id, packingMaterialUse.receiptId))
    .innerJoin(mixingRuns, eq(mixingRuns.id, batchPackingReceipts.mixingRunId))
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .innerJoin(packagingMaterials, eq(packagingMaterials.id, packingMaterialUse.materialId))
    .where(and(
      or(eq(packingMaterialUse.measuredInKg, true), gt(packingMaterialUse.extraQuantity, "0")),
      between(batchPackingReceipts.packedAt, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(batchPackingReceipts.packedAt), desc(batchPackingReceipts.id), packagingMaterials.name);
  return rows.map((row) => toPackingRow(row, limits));
}

async function storeRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    id: materialAdjustments.id, date: materialAdjustments.createdAt, storeId: warehouses.id, store: warehouses.name,
    materialType: materialAdjustments.materialType, chemicalId: chemicals.id, chemicalName: chemicals.name, chemicalUnit: chemicals.unit,
    packagingId: packagingMaterials.id, packagingName: packagingMaterials.name, measuredInKg: packagingMaterials.measuredInKg,
    lotPrice: materialLots.unitPrice, delta: materialAdjustments.delta, value: materialAdjustments.value,
    reasonCode: materialAdjustments.reason, note: materialAdjustments.note, by: user.name,
  }).from(materialAdjustments)
    .innerJoin(warehouses, eq(warehouses.id, materialAdjustments.warehouseId))
    .innerJoin(materialLots, eq(materialLots.id, materialAdjustments.lotId))
    .innerJoin(user, eq(user.id, materialAdjustments.performedById))
    .leftJoin(chemicals, eq(chemicals.id, materialAdjustments.chemicalId))
    .leftJoin(packagingMaterials, eq(packagingMaterials.id, materialAdjustments.packagingMaterialId))
    .where(and(
      lt(materialAdjustments.delta, "0"),
      inArray(materialAdjustments.reason, [...STORE_LOSS_REASONS]),
      between(materialAdjustments.createdAt, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(materialAdjustments.createdAt), desc(materialAdjustments.id));
  return rows.map((row) => toStoreRow(row, limits));
}

const LOADERS: Record<LossTab, (reader: Reader, bounds: LossBounds, limits: LossLimits) => Promise<LossRow[]>> = {
  batch: batchRows, chemical: chemicalRows, powder: powderRows, packing: packingRows, store: storeRows,
};

export function loadLossRows(reader: Reader, tab: LossTab, bounds: LossBounds, limits: LossLimits) {
  return LOADERS[tab](reader, bounds, limits);
}

export async function readLossLimits(reader: Reader) {
  const [row] = await reader.select({
    batch: productionLossLimits.batch, chemical: productionLossLimits.chemical, powder: productionLossLimits.powder,
    shopper: productionLossLimits.shopper, otherPacking: productionLossLimits.otherPacking, updatedAt: productionLossLimits.updatedAt, updatedBy: user.name,
  }).from(productionLossLimits)
    .leftJoin(user, eq(user.id, productionLossLimits.updatedBy))
    .where(eq(productionLossLimits.id, PRODUCTION_LOSS_LIMITS_ID));
  if (!row) return { limits: DEFAULT_LOSS_LIMITS, updatedAt: null, updatedBy: null };
  const { updatedAt, updatedBy, ...limits } = row;
  return { limits, updatedAt: updatedAt.toISOString(), updatedBy: updatedBy ?? null };
}
