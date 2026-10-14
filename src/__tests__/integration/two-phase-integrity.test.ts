import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, user, warehouses, products, packagingMaterials, recipes, cartons, adjustmentLog, finishedGoodsStock } from "@/db";
import { formulas, mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { runIntegrityCheck } from "@/lib/cartons/carton-extended.service";

describe.skipIf(!process.env.TEST_DATABASE_URL)("allocation integrity reconciliation", () => {
  it("detects ledger-only batches and finished stock drift while respecting scope", async () => {
    const rollback = new Error("rollback integrity fixture");
    try {
      await db.transaction(async tx => {
        const id = randomUUID();
        const [actor] = await tx.insert(user).values({ id, name: id, email: `${id}@test.invalid` }).returning();
        const [warehouse] = await tx.insert(warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
        const [product] = await tx.insert(products).values({ name: id }).returning();
        const [master] = await tx.insert(packagingMaterials).values({ name: id, type: "master", costPerUnit: "1" }).returning();
        const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "10", batchUnit: "kg" }).returning();
        const [recipe] = await tx.insert(recipes).values({ productId: product.id, formulaId: formula.id, name: id, batchSize: "10", batchUnit: "kg", containerType: "pack", containerPackagingId: master.id, cartonPackagingId: master.id, containersPerCarton: 4, fillAmount: "1", fillUnit: "kg" }).returning();
        const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "10", bulkUnit: "kg", status: "completed" }).returning();
        const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: recipe.id, warehouseId: warehouse.id, operatorId: actor.id, allocatedBulkQuantity: "4", allocatedBulkUnit: "kg", allocatedChemicalCost: "52", targetContainers: 4, completedContainers: 4, status: "in_progress" }).returning();
        await completePackagingAllocationCore(tx, allocation.id, actor.id);
        const [other] = await tx.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: recipe.id, warehouseId: warehouse.id, operatorId: actor.id, allocatedBulkQuantity: "1", allocatedBulkUnit: "kg", allocatedChemicalCost: "13", targetContainers: 1 }).returning();

        // Keep all domain queries on the rollback transaction, including the original
        // integrity implementation's direct db calls. No HTTP/session behavior is mocked.
        const spies = [
          vi.spyOn(db, "execute").mockImplementation(tx.execute.bind(tx) as typeof db.execute),
          vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx) as typeof db.select),
          vi.spyOn(db, "insert").mockImplementation(tx.insert.bind(tx) as typeof db.insert),
          vi.spyOn(db, "transaction").mockImplementation(((callback: Parameters<typeof db.transaction>[0]) => tx.transaction(callback)) as typeof db.transaction),
        ];
        try {
          expect((await runIntegrityCheck(allocation.id)).allBalanced).toBe(true);
          await tx.update(cartons).set({ sku: null }).where(eq(cartons.packagingAllocationId, allocation.id));
          await tx.update(adjustmentLog).set({ sku: null }).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
          expect((await runIntegrityCheck(allocation.id)).allBalanced).toBe(true);
          await tx.update(cartons).set({ sku: recipe.name }).where(eq(cartons.packagingAllocationId, allocation.id));
          await tx.update(adjustmentLog).set({ sku: recipe.name }).where(eq(adjustmentLog.packagingAllocationId, allocation.id));
          await tx.update(finishedGoodsStock).set({ quantityContainers: 1 }).where(eq(finishedGoodsStock.recipeId, recipe.id));
          expect((await runIntegrityCheck(allocation.id)).allBalanced).toBe(false);
          await tx.update(finishedGoodsStock).set({ quantityContainers: 0, totalInventoryValue: "99" }).where(eq(finishedGoodsStock.recipeId, recipe.id));
          expect((await runIntegrityCheck(allocation.id)).allBalanced).toBe(false);
          await tx.update(finishedGoodsStock).set({ totalInventoryValue: "52" }).where(eq(finishedGoodsStock.recipeId, recipe.id));
          expect((await runIntegrityCheck(allocation.id)).allBalanced).toBe(true);

          // Retired groups disappear from carton totals, but their outstanding ledger
          // balance must still be inspected. Valid retirement records the negative delta.
          await tx.update(cartons).set({ status: "RETIRED", currentPacks: 0 }).where(eq(cartons.packagingAllocationId, allocation.id));
          await tx.update(finishedGoodsStock).set({ quantityCartons: 0, totalInventoryValue: "0" }).where(eq(finishedGoodsStock.recipeId, recipe.id));
          const mismatch = await runIntegrityCheck(allocation.id);
          expect(mismatch.allBalanced).toBe(false);
          expect(mismatch.mismatches).toEqual(expect.arrayContaining([
            expect.objectContaining({ packaging_allocation_id: allocation.id, carton_sum: "0", ledger_total: "4" }),
          ]));
          expect((await runIntegrityCheck(other.id)).mismatches).toHaveLength(0);
          const [carton] = await tx.select().from(cartons).where(eq(cartons.packagingAllocationId, allocation.id));
          await tx.insert(adjustmentLog).values({ cartonId: carton.id, packagingAllocationId: allocation.id, sku: carton.sku, type: "RETIRE", packsBefore: 4, delta: -4, packsAfter: 0, performedBy: actor.id });
          expect((await runIntegrityCheck(allocation.id)).allBalanced).toBe(true);
        } finally {
          spies.forEach(spy => spy.mockRestore());
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
