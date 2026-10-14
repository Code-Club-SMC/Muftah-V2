import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { formulas, formulaIngredients, mixingRuns, mixingProgressLogs, mixingMaterialsUsed, packagingAllocations, packagingProgressLogs, packagingMaterialsUsed } from "@/db/schemas/production-schema";

describe.skipIf(!process.env.TEST_DATABASE_URL)("two phase clean schema", () => {
  it("applies every migration to an empty database and resolves the new relations", async () => {
    const name = `titan_schema_${randomUUID().replaceAll("-", "")}_test`;
    const adminUrl = new URL(process.env.TEST_DATABASE_URL!);
    adminUrl.pathname = "/postgres";
    const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    const cleanUrl = new URL(adminUrl);
    cleanUrl.pathname = `/${name}`;
    const pool = new Pool({ connectionString: cleanUrl.toString(), max: 1 });
    try {
      // The identifier is generated internally, contains only letters/numbers/_,
      // and is never taken from the environment or supplied by the caller.
      await admin.query(`CREATE DATABASE "${name}"`);
      const clean = drizzle(pool, { schema: db._.fullSchema });
      await migrate(clean, { migrationsFolder: "src/db/migrations" });
      const names = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      expect(names.rows.map(row => row.tablename)).toEqual(expect.arrayContaining([
        "formulas", "formula_ingredients", "mixing_runs", "mixing_progress_logs",
        "mixing_materials_used", "packaging_allocations", "packaging_progress_logs", "packaging_materials_used_in_allocation",
      ]));
      const foreignKeys = await pool.query("SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace");
      for (const table of ["cartons", "adjustment_log", "wac_history"]) {
        expect(foreignKeys.rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ table_name: table, definition: expect.stringContaining("REFERENCES packaging_allocations(id)") }),
        ]));
      }
      const id = randomUUID();
      const [actor] = await clean.insert(db._.fullSchema.user).values({ id, name: id, email: `${id}@test.invalid` }).returning();
      const [warehouse] = await clean.insert(db._.fullSchema.warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
      const [product] = await clean.insert(db._.fullSchema.products).values({ name: id }).returning();
      const [chemical] = await clean.insert(db._.fullSchema.chemicals).values({ name: id }).returning();
      const [material] = await clean.insert(db._.fullSchema.packagingMaterials).values({ name: id }).returning();
      const [formula] = await clean.insert(formulas).values({ productId: product.id, name: id, batchSize: "1" }).returning();
      await clean.insert(formulaIngredients).values({ formulaId: formula.id, chemicalId: chemical.id, quantityPerBatch: "1" });
      const [recipe] = await clean.insert(db._.fullSchema.recipes).values({ formulaId: formula.id, productId: product.id, name: id, batchSize: "1", batchUnit: "kg", containerType: "pack", containerPackagingId: material.id, fillAmount: "1", fillUnit: "kg" }).returning();
      const [run] = await clean.insert(mixingRuns).values({ formulaId: formula.id, batchId: "A0001", warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "1", bulkUnit: "kg" }).returning();
      await clean.insert(mixingProgressLogs).values({ mixingRunId: run.id, quantityProduced: "1", createdById: actor.id });
      await clean.insert(mixingMaterialsUsed).values({ mixingRunId: run.id, chemicalId: chemical.id, quantityUsed: "1", costPerUnit: "1", totalCost: "1" });
      const [allocation] = await clean.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: recipe.id, warehouseId: warehouse.id, operatorId: actor.id, allocatedBulkQuantity: "1", allocatedBulkUnit: "kg", allocatedChemicalCost: "1", targetContainers: 1 }).returning();
      const [log] = await clean.insert(packagingProgressLogs).values({ packagingAllocationId: allocation.id, containersProduced: 1, bulkConsumed: "1", createdById: actor.id }).returning();
      await clean.insert(packagingMaterialsUsed).values({ packagingAllocationId: allocation.id, progressLogId: log.id, materialId: material.id, quantityUsed: "1", costPerUnit: "1", totalCost: "1" });
      const loaded = await clean.query.mixingRuns.findFirst({ with: {
        formula: { with: { product: true, ingredients: { with: { chemical: true } }, recipes: true } },
        progressLogs: true, materialsUsed: true,
        packagingAllocations: { with: { recipe: true, progressLogs: true, materialsUsed: true } },
      } });
      expect(loaded?.formula.product.id).toBe(product.id);
      expect(loaded?.formula.ingredients[0].chemical.id).toBe(chemical.id);
      expect(loaded?.progressLogs).toHaveLength(1);
      expect(loaded?.materialsUsed).toHaveLength(1);
      expect(loaded?.packagingAllocations[0].recipe.id).toBe(recipe.id);
      expect(loaded?.packagingAllocations[0].progressLogs).toHaveLength(1);
      expect(loaded?.packagingAllocations[0].materialsUsed).toHaveLength(1);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });
});
