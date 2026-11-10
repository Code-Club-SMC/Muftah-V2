import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  db,
  chemicals,
  materialLots,
  materialLotStock,
  materialStock,
  packagingMaterials,
  recipes,
  products,
  finishedGoodsStock,
  warehouses,
} from "@/db";
import { cartons } from "@/db/schemas/manufacturing-schema";
import { finishedAvailableUnits } from "@/lib/inventory/finished-stock-availability.server";
import { getLowStockAlertsFn } from "@/server-functions/inventory/stock/get-low-stocks-alert-fn";
import { getFactoryFloorStockFn } from "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn";
import { withRollback } from "./with-rollback";

vi.mock("@/lib/middlewares", () => ({ requireFactoryFloorViewMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, handler: (fn: unknown) => fn };
    return b;
  },
}));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "low stock alerts, isolated SQL fixtures",
  () => {
    it("covers absent stock, multiple lots, KG packaging, active floor scope and physical pack availability", () =>
      withRollback(async (tx) => {
        const selectSpy = vi
          .spyOn(db, "select")
          .mockImplementation(tx.select.bind(tx) as typeof db.select);
        const floorSpy = vi
          .spyOn(db.query.warehouses, "findFirst")
          .mockImplementation(
            tx.query.warehouses.findFirst.bind(tx.query.warehouses),
          );
        const mixingSpy = vi
          .spyOn(db.query.mixingRuns, "findMany")
          .mockImplementation(
            tx.query.mixingRuns.findMany.bind(tx.query.mixingRuns),
          );
        const createdFloors: string[] = [];
        try {
          await tx
            .update(warehouses)
            .set({ isActive: false })
            .where(eq(warehouses.type, "factory_floor"));
          const name = randomUUID();
          const floorValues = {
            name,
            address: "Test",
            city: "Test",
            state: "Test",
            latitude: "0",
            longitude: "0",
            type: "factory_floor",
          };
          const [floor, second, inactive] = await tx
            .insert(warehouses)
            .values([
              { ...floorValues, createdAt: new Date("2000-01-01") },
              { ...floorValues, createdAt: new Date("2001-01-01") },
              { ...floorValues, isActive: false },
            ])
            .returning();
          createdFloors.push(floor.id, second.id, inactive.id);
          const [chemical, absent] = await tx
            .insert(chemicals)
            .values([
              { name: `${name} Soda`, minimumStockLevel: "5.00" },
              { name: `${name} Absent`, minimumStockLevel: "0" },
            ])
            .returning();
          const lots = await tx
            .insert(materialLots)
            .values(
              [1, 2].map((price) => ({
                chemicalId: chemical.id,
                unitPrice: String(price),
              })),
            )
            .returning();
          await tx
            .insert(materialLotStock)
            .values(
              lots.map((lot) => ({
                lotId: lot.id,
                warehouseId: floor.id,
                quantity: "2.500",
              })),
            );
          await tx.insert(materialStock).values([
            {
              chemicalId: chemical.id,
              warehouseId: floor.id,
              quantity: "5.000",
            },
            {
              chemicalId: absent.id,
              warehouseId: inactive.id,
              quantity: "100",
            },
          ]);
          const [pack, box] = await tx
            .insert(packagingMaterials)
            .values([
              {
                name: `${name} Shopper`,
                measuredInKg: true,
                weightPerPack: "6",
                minimumStockLevel: 0,
              },
              { name: `${name} Carton`, type: "master" },
            ])
            .returning();
          const [product] = await tx
            .insert(products)
            .values({ name })
            .returning();
          const base = {
            productId: product.id,
            batchSize: "100",
            containerType: "pack",
            containerPackagingId: pack.id,
          };
          const [recipe, loose, empty, disabled] = await tx
            .insert(recipes)
            .values([
              {
                ...base,
                name: `${name} Bottled`,
                cartonPackagingId: box.id,
                containersPerCarton: 12,
                minimumStockLevel: 20,
              },
              { ...base, name: `${name} Loose`, minimumStockLevel: 10 },
              { ...base, name: `${name} Empty`, minimumStockLevel: 0 },
              {
                ...base,
                name: `${name} Disabled`,
                isActive: false,
                minimumStockLevel: 100,
              },
            ])
            .returning();
          await tx.insert(finishedGoodsStock).values([
            {
              warehouseId: floor.id,
              recipeId: recipe.id,
              quantityCartons: 3,
              quantityContainers: 99,
              quantityOutsidePacks: 2,
            },
            {
              warehouseId: floor.id,
              recipeId: loose.id,
              quantityContainers: 9,
            },
            {
              warehouseId: second.id,
              recipeId: empty.id,
              quantityContainers: 100,
            },
          ]);
          await tx.insert(cartons).values([
            ...[
              { status: "PARTIAL", currentPacks: 3 },
              { status: "COMPLETE", currentPacks: 12 },
              { status: "ON_HOLD", currentPacks: 9 },
              { status: "DISPATCHED", currentPacks: 12 },
              { status: "ARCHIVED", currentPacks: 12 },
            ].map((row) => ({
              ...row,
              recipeId: recipe.id,
              warehouseId: floor.id,
              capacity: 12,
            })),
            {
              recipeId: recipe.id,
              warehouseId: inactive.id,
              capacity: 12,
              currentPacks: 12,
              status: "SEALED",
            },
          ]);
          expect((await finishedAvailableUnits(floor.id)).get(recipe.id)).toBe(
            17,
          );
          expect((await finishedAvailableUnits(floor.id)).get(loose.id)).toBe(
            9,
          );
          const alerts = await (
            getLowStockAlertsFn as unknown as () => Promise<any[]>
          )();
          expect(
            alerts.find((r) => r.materialId === chemical.id),
          ).toMatchObject({ currentStock: "5.000", status: "low" });
          expect(
            alerts.filter((r) => r.materialId === chemical.id),
          ).toHaveLength(1);
          expect(alerts.find((r) => r.materialId === absent.id)).toMatchObject({
            currentStock: "0",
            status: "out",
          });
          expect(alerts.find((r) => r.materialId === pack.id)).toMatchObject({
            currentStock: "0",
            status: "out",
            unit: "kg",
          });
          expect(alerts.find((r) => r.materialId === recipe.id)).toMatchObject({
            currentStock: "17",
            status: "low",
          });
          expect(alerts.find((r) => r.materialId === empty.id)).toMatchObject({
            currentStock: "0",
            status: "out",
          });
          expect(alerts.some((r) => r.materialId === disabled.id)).toBe(false);
          expect(alerts.every((r) => r.warehouseId === floor.id)).toBe(true);
          expect(
            (await (getFactoryFloorStockFn as unknown as () => Promise<any>)())
              .id,
          ).toBe(floor.id);
          await tx
            .update(warehouses)
            .set({ isActive: false })
            .where(inArray(warehouses.id, createdFloors));
          expect(
            await (getLowStockAlertsFn as unknown as () => Promise<any[]>)(),
          ).toEqual([]);
        } finally {
          selectSpy.mockRestore();
          floorSpy.mockRestore();
          mixingSpy.mockRestore();
        }
      }));
  },
);
