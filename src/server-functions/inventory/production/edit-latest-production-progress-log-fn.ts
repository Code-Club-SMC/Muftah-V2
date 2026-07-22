import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  finishedGoodsStock,
  materialStock,
  productionMaterialsUsed,
  productionProgressLogs,
  productionRuns,
  recipes,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { applyProductionProgressLog } from "./production-progress-core";

const editLatestProductionProgressLogSchema = z.object({
  productionRunId: z.string().min(1),
  progressLogId: z.string().min(1),
  unitsProduced: z.number().int().positive("Must be a positive number"),
  editReason: z.string().trim().min(5, "Edit reason is required"),
});

export const editLatestProductionProgressLogFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(editLatestProductionProgressLogSchema)
  .handler(async ({ data, context }) => {
    const canEditProgress =
      hasPermission(context.authContext.permissions, "operator.run.log") ||
      hasPermission(context.authContext.permissions, "manufacturing.run.manage");

    if (!canEditProgress) {
      throw new Error("You do not have permission to edit production progress.");
    }

    return await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(productionRuns)
        .where(eq(productionRuns.id, data.productionRunId));

      if (!run) {
        throw new Error("Production run not found");
      }

      if (run.status !== "in_progress") {
        throw new Error(
          "Only in-progress runs support latest-log edits. Completed runs must be reviewed by admin.",
        );
      }

      const latestLog = await tx.query.productionProgressLogs.findFirst({
        where: eq(productionProgressLogs.productionRunId, run.id),
        orderBy: [desc(productionProgressLogs.createdAt), desc(productionProgressLogs.id)],
      });

      if (!latestLog) {
        throw new Error("No operator progress log found for this run.");
      }

      if (latestLog.id !== data.progressLogId) {
        throw new Error("Only latest log can be edited.");
      }

      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, run.recipeId));

      if (!recipe) {
        throw new Error("Recipe not found");
      }

      const factoryFloor = await tx.query.warehouses.findFirst({
        where: eq(warehouses.type, "factory_floor"),
      });

      if (!factoryFloor) {
        throw new Error("Factory floor not found");
      }

      const groupedMaterials = await tx.query.productionMaterialsUsed.findMany({
        where: and(
          eq(productionMaterialsUsed.productionRunId, run.id),
          eq(productionMaterialsUsed.progressLogId, latestLog.id),
        ),
      });

      if (groupedMaterials.length === 0) {
        throw new Error(
          "Latest log cannot be edited because its material deductions are not traceable.",
        );
      }

      for (const row of groupedMaterials) {
        await tx
          .update(materialStock)
          .set({
            quantity: sql`quantity + ${row.quantityUsed}`,
          })
          .where(
            and(
              eq(materialStock.warehouseId, factoryFloor.id),
              row.materialType === "chemical"
                ? eq(materialStock.chemicalId, row.materialId)
                : eq(materialStock.packagingMaterialId, row.materialId),
            ),
          );
      }

      const existingStock = await tx.query.finishedGoodsStock.findFirst({
        where: and(
          eq(finishedGoodsStock.warehouseId, factoryFloor.id),
          eq(finishedGoodsStock.recipeId, run.recipeId),
        ),
      });

      const currentLoose = existingStock?.quantityContainers ?? 0;
      if (currentLoose < latestLog.unitsProduced) {
        throw new Error(
          "Latest log cannot be edited because finished-goods stock already moved beyond this point.",
        );
      }

      if (existingStock) {
        await tx
          .update(finishedGoodsStock)
          .set({
            quantityContainers: currentLoose - latestLog.unitsProduced,
            updatedAt: new Date(),
          })
          .where(eq(finishedGoodsStock.id, existingStock.id));
      }

      const reversedPackagingCost = groupedMaterials.reduce(
        (sum, row) => sum + parseFloat(row.totalCost?.toString() || "0"),
        0,
      );

      await tx
        .update(productionRuns)
        .set({
          completedUnits: Math.max(0, (run.completedUnits || 0) - latestLog.unitsProduced),
          totalPackagingCost: Math.max(
            0,
            parseFloat(run.totalPackagingCost?.toString() || "0") - reversedPackagingCost,
          ).toFixed(2),
          totalProductionCost: Math.max(
            0,
            parseFloat(run.totalProductionCost?.toString() || "0") - reversedPackagingCost,
          ).toFixed(2),
        })
        .where(eq(productionRuns.id, run.id));

      await tx
        .delete(productionMaterialsUsed)
        .where(eq(productionMaterialsUsed.progressLogId, latestLog.id));

      await tx
        .update(productionProgressLogs)
        .set({
          unitsProduced: data.unitsProduced,
          originalUnitsProduced:
            latestLog.originalUnitsProduced ?? latestLog.unitsProduced,
          editedById: context.session.user.id,
          editReason: data.editReason,
          editedAt: new Date(),
        })
        .where(eq(productionProgressLogs.id, latestLog.id));

      return applyProductionProgressLog({
        tx,
        run: {
          ...run,
          completedUnits: Math.max(0, (run.completedUnits || 0) - latestLog.unitsProduced),
          totalPackagingCost: Math.max(
            0,
            parseFloat(run.totalPackagingCost?.toString() || "0") - reversedPackagingCost,
          ).toFixed(2),
          totalProductionCost: Math.max(
            0,
            parseFloat(run.totalProductionCost?.toString() || "0") - reversedPackagingCost,
          ).toFixed(2),
        },
        recipe,
        unitsProduced: data.unitsProduced,
        performedById: context.session.user.id,
        progressLogId: latestLog.id,
      });
    });
  });
