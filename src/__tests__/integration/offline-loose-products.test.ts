import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, finishedGoodsStock, packagingMaterials, products, recipes, warehouses } from "@/db";
import { entityRecipeRates } from "@/db/schemas/sales-erp-schema";
import { GENERAL_RECIPE_RATE_ENTITY_ID } from "@/lib/sales/entity-recipe-rate-config";
import { buildOfflineSalesReferenceSnapshot } from "@/lib/sales/offline/reference-snapshot.server";

const rollback = new Error("rollback");

describe.skipIf(!process.env.TEST_DATABASE_URL)("offline product list", () => {
  it("lists packs sold without cartons, with their stock and no carton rate", async () => {
    await db.transaction(async (tx) => {
      const id = randomUUID();
      if (!(await tx.query.warehouses.findFirst({ where: (row, { eq }) => eq(row.type, "factory_floor") })))
        await tx.insert(warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" });
      const { factoryWarehouseId } = await buildOfflineSalesReferenceSnapshot(tx);
      const [product] = await tx.insert(products).values({ name: "Detergent" }).returning();
      const [pack] = await tx.insert(packagingMaterials).values({ name: id }).returning();
      const format = { productId: product.id, batchSize: "500", batchUnit: "kg", containerType: "pack", containerPackagingId: pack.id };
      const [loose, carton] = await tx.insert(recipes).values([
        { ...format, name: `${id} 20kg`, containersPerCarton: 0 },
        { ...format, name: `${id} 600ml`, containersPerCarton: 12 },
      ]).returning();
      await tx.insert(finishedGoodsStock).values({ warehouseId: factoryWarehouseId, recipeId: loose.id, quantityContainers: 24, quantityOutsidePacks: 24, weightedAverageCostPerPack: "2913.6233" });
      await tx.insert(entityRecipeRates).values([loose, carton].map((row) => ({ entityType: "general" as const, entityId: GENERAL_RECIPE_RATE_ENTITY_ID, recipeId: row.id, pricePerCarton: "4000" })));
      const listed = new Map((await buildOfflineSalesReferenceSnapshot(tx)).products.map((row) => [row.recipeId, row]));
      expect(listed.get(loose.id)).toMatchObject({ packsPerCarton: 1, looseOnly: true, stockUnits: 24, wacPerPack: "2913.6233", generalCartonPrice: "0.00", distributorPrices: [] });
      expect(listed.get(carton.id)).toMatchObject({ packsPerCarton: 12, stockUnits: 0, generalCartonPrice: "4000.00" });
      expect(listed.get(carton.id)).not.toHaveProperty("looseOnly");
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  });
});
