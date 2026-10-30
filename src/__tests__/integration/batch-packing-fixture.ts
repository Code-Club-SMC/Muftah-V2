// Shared seed for batch packing integration suites: one completed 500 kg batch,
// a pack and a carton material with stock on the factory floor, and four formats.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, user, warehouses, products, packagingMaterials, recipes } from "@/db";
import { formulas, mixingRuns } from "@/db/schemas/production-schema";
import { recordBatchPackingCore, type BatchPackingInput, type PackingActor } from "@/server-functions/manufacturing/packaging/batch-packing-core.server";
import { findOrCreateLot, listLotBalances, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { calculatePackingLine, packingMaterialNeeds } from "@/lib/production/batch-packing";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("Rollback batch packing fixture");
export async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Packing actor", email: `${id}@test.invalid` }).returning();
  const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };
  const [warehouse] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [target] = await tx.insert(warehouses).values({ ...warehouseValues, type: "warehouse", name: `${id}-target` }).returning();
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [primary] = await tx.insert(packagingMaterials).values({ name: `${id}-pack`, costPerUnit: "2" }).returning();
  const [master] = await tx.insert(packagingMaterials).values({ name: `${id}-carton`, type: "master", costPerUnit: "5" }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "500", batchUnit: "kg" }).returning();
  const formats = await tx.insert(recipes).values([
    { name: `${id}-250g`, fillAmount: "250", fillUnit: "g", containersPerCarton: 40, cartonPackagingId: master.id },
    { name: `${id}-500g`, fillAmount: "500", fillUnit: "g", containersPerCarton: 20, cartonPackagingId: master.id },
    { name: `${id}-400g`, fillAmount: "400", fillUnit: "g", containersPerCarton: 25, cartonPackagingId: master.id },
    { name: `${id}-1kg`, fillAmount: "1", fillUnit: "kg", containersPerCarton: 0, cartonPackagingId: null },
  ].map(row => ({ ...row, productId: product.id, formulaId: formula.id, batchSize: "500", batchUnit: "kg", containerType: "pack", containerPackagingId: primary.id }))).returning();
  const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "500", actualBulkProduced: "500", totalChemicalCost: "5000", bulkUnit: "kg", status: "completed" }).returning();
  const packRef = { materialType: "packaging" as const, materialId: primary.id };
  const cartonRef = { materialType: "packaging" as const, materialId: master.id };
  await lockMaterialStock(tx, [warehouse.id], [packRef, cartonRef]);
  const packLot = await findOrCreateLot(tx, packRef, "2");
  const cartonLot = await findOrCreateLot(tx, cartonRef, "5");
  await moveLotStock(tx, { ref: packRef, lotId: packLot.id, warehouseId: warehouse.id, delta: "10000", sourceType: "purchase" });
  await moveLotStock(tx, { ref: cartonRef, lotId: cartonLot.id, warehouseId: warehouse.id, delta: "1000", sourceType: "purchase" });
  const input = { mixingRunId: run.id, requestId: randomUUID(), packedAt: new Date("2026-10-09T09:00:00Z"), lossBulk: "0", lines: [{ recipeId: formats[0].id, fullCartons: 20, partialPacks: 0, loosePacks: 0 }, { recipeId: formats[1].id, fullCartons: 10, partialPacks: 0, loosePacks: 0 }, { recipeId: formats[2].id, fullCartons: 10, partialPacks: 0, loosePacks: 0 }, { recipeId: formats[3].id, fullCartons: 0, partialPacks: 0, loosePacks: 100 }] };
  return { actor: { id: actor.id, permissions: ["manufacturing.run.manage"] }, warehouse, target, product, primary, master, packLot, cartonLot, formula, formats, run, input };
}
// Each packaging material's whole need comes from its first lot in the batch's store, unless the test picks.
export async function withLots(tx: Tx, input: Omit<BatchPackingInput, "lotPicks"> & { lotPicks?: BatchPackingInput["lotPicks"] }): Promise<BatchPackingInput> {
  if (input.lotPicks) return input as BatchPackingInput;
  const [run] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, input.mixingRunId));
  const formats = await tx.select().from(recipes).where(inArray(recipes.id, input.lines.map(line => line.recipeId)));
  const needs = packingMaterialNeeds(input.lines.map(line => {
    const format = formats.find(row => row.id === line.recipeId)!;
    const usesCartons = !!format.cartonPackagingId && (format.containersPerCarton ?? 0) > 0;
    const quantity = calculatePackingLine(line, { ...format, containersPerCarton: format.containersPerCarton ?? 0, usesCartons }, run.bulkUnit);
    return { formatId: format.id, containerPackagingId: format.containerPackagingId, cartonPackagingId: format.cartonPackagingId, totalPacks: quantity.totalPacks, physicalCartons: quantity.physicalCartons };
  }), []);
  const lotPicks = await Promise.all([...needs].sort(([a], [b]) => a.localeCompare(b)).map(async ([materialId, need]) => {
    const [lot] = await listLotBalances(tx, run.warehouseId, { materialType: "packaging", materialId });
    return { materialId, picks: [{ lotId: lot.lotId, quantity: need.total.toString() }] };
  }));
  return { ...input, lotPicks };
}
export async function record(tx: Tx, input: Parameters<typeof withLots>[1], actor: PackingActor) {
  return recordBatchPackingCore(tx, await withLots(tx, input), actor);
}
export async function fixture(check: (tx: Tx, f: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Use isolated TEST_DATABASE_URL");
  try { await db.transaction(async tx => { await check(tx, await seed(tx)); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
export type PackingFixture = Awaited<ReturnType<typeof seed>>;
