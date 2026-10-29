import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  db,
  user,
  products,
  warehouses,
  chemicals,
  materialStock,
  appRoles,
  appPermissions,
  appRolePermissions,
  userRoleAssignments,
} from "@/db";
import {
  formulas,
  formulaIngredients,
  mixingRuns,
  mixingMaterialsUsed,
} from "@/db/schemas/production-schema";
import { createMixingRunFn } from "@/server-functions/manufacturing/mixing/create-mixing-run-fn";
import { listLotBalances, lockMaterialStock } from "@/lib/inventory/material-lots.server";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
import { getMixingStockAvailabilityFn } from "@/server-functions/manufacturing/mixing/get-mixing-stock-availability-fn";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown };
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: typeof validator) => {
        validator = schema;
        return builder;
      },
      handler:
        (handler: (input: unknown) => unknown) =>
        (input: { data: unknown; context: unknown }) =>
          handler({ ...input, data: validator.parse(input.data) }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireManufacturingRunManageMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

function invoke(fn: unknown, data: unknown, actorId: string) {
  const session = { user: { id: actorId, name: "Stock test" } };
  return (fn as (input: unknown) => Promise<any>)({
    data,
    context: {
      session,
      authContext: { session, permissions: ["manufacturing.run.manage"] },
    },
  });
}

describe("mixing creation stock checks against PostgreSQL", () => {
  it("rejects all shortages without creating or consuming, then rechecks stock at start", async () => {
    if (
      !process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
    )
      throw new Error("Requires isolated test database");
    const rollback = new Error("rollback fixture");
    try {
      await db.transaction(async (tx) => {
        const id = randomUUID();
        const [actor] = await tx
          .insert(user)
          .values({ id, name: "Stock test", email: `${id}@test.invalid` })
          .returning();
        const [role] = await tx
          .insert(appRoles)
          .values({ slug: id, name: "Stock test operator" })
          .returning();
        const keys = ["operator.run.read", "operator.run.log"];
        await tx
          .insert(appPermissions)
          .values(
            keys.map((key) => ({ key, moduleKey: "operator", label: key })),
          )
          .onConflictDoNothing();
        const permissions = await tx
          .select()
          .from(appPermissions)
          .where(inArray(appPermissions.key, keys));
        await tx
          .insert(appRolePermissions)
          .values(
            permissions.map((permission) => ({
              roleId: role.id,
              permissionId: permission.id,
            })),
          );
        await tx
          .insert(userRoleAssignments)
          .values({ userId: actor.id, roleId: role.id });
        const [floor] = await tx
          .insert(warehouses)
          .values({
            name: id,
            address: "Test",
            city: "Test",
            state: "Test",
            latitude: "0",
            longitude: "0",
            type: "factory_floor",
          })
          .returning();
        const [product] = await tx
          .insert(products)
          .values({ name: id })
          .returning();
        const [formula] = await tx
          .insert(formulas)
          .values({
            productId: product.id,
            name: id,
            batchSize: "10",
            batchUnit: "kg",
          })
          .returning();
        const [acid] = await tx
          .insert(chemicals)
          .values({ name: "Citric acid", unit: "kg", costPerUnit: "10" })
          .returning();
        const [water] = await tx
          .insert(chemicals)
          .values({ name: "Water", unit: "liters", costPerUnit: "1" })
          .returning();
        await tx.insert(formulaIngredients).values([
          {
            formulaId: formula.id,
            chemicalId: acid.id,
            quantityPerBatch: "1.100",
          },
          {
            formulaId: formula.id,
            chemicalId: acid.id,
            quantityPerBatch: "2.200",
          },
          {
            formulaId: formula.id,
            chemicalId: water.id,
            quantityPerBatch: "5.000",
          },
        ]);
        await tx
          .insert(materialStock)
          .values({
            warehouseId: floor.id,
            chemicalId: acid.id,
            quantity: "1.200",
          });
        const transactionSpy = vi
          .spyOn(db, "transaction")
          .mockImplementation(((
            callback: Parameters<typeof db.transaction>[0],
          ) => tx.transaction(callback)) as typeof db.transaction);
        try {
          const request = {
            formulaId: formula.id,
            warehouseId: floor.id,
            operatorId: actor.id,
          };
          const availability = await invoke(
            getMixingStockAvailabilityFn,
            request,
            actor.id,
          );
          const rejected = await invoke(createMixingRunFn, request, actor.id);
          expect(rejected.success).toBe(false);
          expect(rejected.shortages).toEqual(availability.shortages);
          expect(rejected.shortages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "Citric acid",
                required: "3.300",
                available: "1.200",
                missing: "2.100",
                unit: "kg",
              }),
              expect.objectContaining({
                name: "Water",
                available: "0.000",
                missing: "5.000",
                unit: "liters",
              }),
            ]),
          );
          expect(
            await tx
              .select()
              .from(mixingRuns)
              .where(eq(mixingRuns.warehouseId, floor.id)),
          ).toHaveLength(0);
          const [unchanged] = await tx
            .select()
            .from(materialStock)
            .where(eq(materialStock.chemicalId, acid.id));
          expect(unchanged.quantity).toBe("1.200");

          await tx
            .update(materialStock)
            .set({ quantity: "3.300" })
            .where(eq(materialStock.chemicalId, acid.id));
          await tx
            .insert(materialStock)
            .values({
              warehouseId: floor.id,
              chemicalId: water.id,
              quantity: "5.000",
            });
          const created = await invoke(createMixingRunFn, request, actor.id);
          expect(created.success).toBe(true);
          const stock = await tx
            .select()
            .from(materialStock)
            .where(eq(materialStock.warehouseId, floor.id));
          expect(stock.map((row) => Number(row.quantity)).sort()).toEqual([
            3.3, 5,
          ]);
          expect(
            await tx
              .select()
              .from(mixingMaterialsUsed)
              .where(eq(mixingMaterialsUsed.mixingRunId, created.mixingRun.id)),
          ).toHaveLength(0);

          await tx
            .update(materialStock)
            .set({ quantity: "1.000" })
            .where(eq(materialStock.chemicalId, acid.id));
          await expect(
            invoke(
              startMixingRunFn,
              { mixingRunId: created.mixingRun.id, lotPicks: [] },
              actor.id,
            ),
          ).rejects.toThrow(
            "Citric acid: requires 3.300 kg, available 1.000 kg, missing 2.300 kg",
          );
          await tx
            .update(materialStock)
            .set({ quantity: "3.300" })
            .where(eq(materialStock.chemicalId, acid.id));
          const refs = [acid, water].map((chemical) => ({
            materialType: "chemical" as const,
            materialId: chemical.id,
          }));
          await lockMaterialStock(tx, [floor.id], refs);
          const lotPicks = await Promise.all(
            [
              { ref: refs[0], quantity: "3.300" },
              { ref: refs[1], quantity: "5.000" },
            ].map(async ({ ref, quantity }) => {
              const [lot] = await listLotBalances(tx, floor.id, ref);
              return {
                materialId: ref.materialId,
                picks: [{ lotId: lot.lotId, quantity }],
              };
            }),
          );
          await invoke(
            startMixingRunFn,
            { mixingRunId: created.mixingRun.id, lotPicks },
            actor.id,
          );
          expect(
            (
              await tx
                .select()
                .from(materialStock)
                .where(eq(materialStock.warehouseId, floor.id))
            ).every((row) => row.quantity === "0.000"),
          ).toBe(true);
        } finally {
          transactionSpy.mockRestore();
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
