import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { db } from "@/db";
import {
  formulas,
  mixingRuns,
  mixingMaterialsUsed,
} from "@/db/schemas/production-schema";
import {
  inventoryAuditLog,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import Big from "big.js";
import {
  loadMixingStockRequirements,
  mixingStockShortageMessage,
} from "@/lib/production/mixing-stock.server";
import { materialLotPicksSchema } from "@/lib/inventory/material-lots";
import {
  lockMaterialStock,
  takeLotPicks,
} from "@/lib/inventory/material-lots.server";

const startMixingRunSchema = z.object({
  mixingRunId: z.string().min(1, "Mixing batch ID is required"),
  lotPicks: z.array(materialLotPicksSchema).max(100),
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

      const refs = materials.map((item) => ({
        materialType: "chemical" as const,
        materialId: item.chemicalId,
      }));
      await lockMaterialStock(tx, [factoryFloor.id], refs);
      let totalChemicalCost = new Big(0);
      for (const item of materials) {
        const chosen = data.lotPicks.find(
          (row) => row.materialId === item.chemicalId,
        );
        if (!chosen) throw new Error(`Pick lots for ${item.name}`);
        const picked = await takeLotPicks(tx, {
          warehouseId: factoryFloor.id,
          ref: { materialType: "chemical", materialId: item.chemicalId },
          name: item.name,
          unit: item.unit,
          required: item.quantity,
          picks: chosen.picks,
          sourceType: "mixing",
          sourceId: mixingRun.id,
        });
        for (const row of picked) {
          totalChemicalCost = totalChemicalCost.plus(row.totalCost);
          await tx.insert(mixingMaterialsUsed).values({
            mixingRunId: mixingRun.id,
            chemicalId: item.chemicalId,
            lotId: row.lotId,
            quantityUsed: row.quantity,
            costPerUnit: row.unitPrice,
            totalCost: row.totalCost,
          });
          await tx.insert(inventoryAuditLog).values({
            warehouseId: factoryFloor.id,
            materialType: "chemical",
            materialId: item.chemicalId,
            lotId: row.lotId,
            type: "debit",
            amount: row.quantity,
            reason: `Mixing batch ${mixingRun.batchId} started`,
            performedById: context.session.user.id,
            referenceId: mixingRun.id,
          });
        }
      }
      const extra = data.lotPicks.find(
        (row) => !materials.some((item) => item.chemicalId === row.materialId),
      );
      if (extra)
        throw new Error(
          "Lots were picked for a chemical that is not in this formula",
        );

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
