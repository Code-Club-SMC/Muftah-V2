import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { db } from "@/db";
import {
  formulas,
  mixingRuns,
  mixingMaterialsUsed,
} from "@/db/schemas/production-schema";
import {
  materialStock,
  inventoryAuditLog,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import Big from "big.js";
import {
  loadMixingStockRequirements,
  mixingStockShortageMessage,
} from "@/lib/production/mixing-stock.server";

const startMixingRunSchema = z.object({
  mixingRunId: z.string().min(1, "Mixing batch ID is required"),
});

export const startMixingRunFn = createServerFn({ method: "POST" })
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(startMixingRunSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const [mixingRun] = await tx
        .select()
        .from(mixingRuns)
        .where(eq(mixingRuns.id, data.mixingRunId))
        .for("update");

      if (!mixingRun) {
        throw new Error("Mixing batch not found");
      }

      if (mixingRun.status !== "scheduled") {
        throw new Error("Mixing batch must be in scheduled status to start");
      }

      const [formula] = await tx
        .select()
        .from(formulas)
        .where(eq(formulas.id, mixingRun.formulaId))
        .for("share");

      if (!formula || !formula.isActive) {
        throw new Error("Active mixing formula not found");
      }

      const factoryFloor = await tx.query.warehouses.findFirst({
        where: and(
          eq(warehouses.id, mixingRun.warehouseId),
          eq(warehouses.type, "factory_floor"),
          eq(warehouses.isActive, true),
        ),
      });

      if (!factoryFloor) {
        throw new Error(
          "Factory floor facility not found. Please create a facility with type 'factory_floor' first.",
        );
      }

      const { materials, shortages } = await loadMixingStockRequirements(
        tx,
        formula.id,
        factoryFloor.id,
      );
      if (shortages.length)
        throw new Error(mixingStockShortageMessage(shortages));

      let totalChemicalCost = new Big(0);

      for (const { chemicalId, quantity, name } of materials) {
        const [deducted] = await tx
          .update(materialStock)
          .set({ quantity: sql`${materialStock.quantity} - ${quantity}` })
          .where(
            and(
              eq(materialStock.warehouseId, factoryFloor.id),
              eq(materialStock.chemicalId, chemicalId),
              gte(materialStock.quantity, quantity),
            ),
          )
          .returning({ id: materialStock.id });
        if (!deducted) {
          throw new Error(
            `Insufficient factory floor stock for ${name}. Refresh stock availability and try again.`,
          );
        }
      }

      for (const item of materials) {
        const totalCost = new Big(item.quantity)
          .times(item.costPerUnit)
          .toFixed(2);
        totalChemicalCost = totalChemicalCost.plus(totalCost);

        await tx.insert(mixingMaterialsUsed).values({
          mixingRunId: mixingRun.id,
          chemicalId: item.chemicalId,
          quantityUsed: item.quantity.toString(),
          costPerUnit: item.costPerUnit.toString(),
          totalCost,
        });

        await tx.insert(inventoryAuditLog).values({
          warehouseId: factoryFloor.id,
          materialType: "chemical",
          materialId: item.chemicalId,
          type: "debit",
          amount: item.quantity.toString(),
          reason: `Mixing batch ${mixingRun.batchId} started`,
          performedById: context.session.user.id,
          referenceId: mixingRun.id,
        });
      }

      await tx
        .update(mixingRuns)
        .set({
          status: "in_progress",
          actualStartDate: new Date(),
          totalChemicalCost: totalChemicalCost.toFixed(2),
        })
        .where(eq(mixingRuns.id, mixingRun.id));

      logActivityQuiet({
        module: "manufacturing",
        action: "updated",
        entityType: "mixing_run",
        entityLabel: mixingRun.batchId,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Started mixing batch ${mixingRun.batchId} for mixing formula ${formula.name}`,
      });

      return {
        success: true,
        mixingRun: {
          ...mixingRun,
          status: "in_progress" as const,
          actualStartDate: new Date(),
        },
      };
    });
  });
