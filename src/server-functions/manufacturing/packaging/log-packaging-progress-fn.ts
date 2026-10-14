import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { packagingAllocations, packagingProgressLogs, packagingMaterialsUsed } from "@/db/schemas/production-schema";
import { recipes, recipePackaging, packagingMaterials, materialStock, inventoryAuditLog } from "@/db/schemas/inventory-schema";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq, and, gte, sql } from "drizzle-orm";
import { z } from "zod";
import Big from "big.js";
import { createId } from "@paralleldrive/cuid2";
import { normalizePackagingUsageBasis } from "@/lib/recipe-packaging";
import { completePackagingAllocationCore } from "./complete-packaging-allocation-core.server";
import { getFillPerContainer } from "@/lib/production/packaging-quantity";

const logProgressSchema = z.object({
  allocationId: z.string().min(1),
  containersProduced: z.number().int().positive("Must be a positive number"),
});

export const logPackagingProgressFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(logProgressSchema)
  .handler(async ({ data, context }) => {
    if (
      !hasPermission(context.authContext.permissions, "operator.run.log") &&
      !hasPermission(context.authContext.permissions, "manufacturing.run.manage")
    ) {
      throw new Error("You do not have permission to log production progress.");
    }

    return await db.transaction(async (tx) => {
      const [allocation] = await tx
        .select()
        .from(packagingAllocations)
        .where(eq(packagingAllocations.id, data.allocationId))
        .for("update");

      if (!allocation) {
        throw new Error("Packing Job not found");
      }
      if (allocation.operatorId !== context.session.user.id &&
          !hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
        throw new Error("This packing job is assigned to another operator");
      }

      if (allocation.status !== "in_progress") {
        throw new Error("Packing Job is not in progress");
      }
      const completedBefore = allocation.completedContainers ?? 0;
      if (completedBefore + data.containersProduced > allocation.targetContainers) {
        throw new Error("Packaging output cannot exceed the packing job target");
      }

      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, allocation.recipeId));

      if (!recipe) {
        throw new Error("Packaging Format not found");
      }

      
      // Enforce full cartons if applicable
      let remaining = 0;
      if (recipe.containersPerCarton && recipe.containersPerCarton > 0 && recipe.cartonPackagingId) {
        // Wait, how do we know remaining? We need the total target containers vs completed containers.
        const totalTarget = allocation.targetContainers;
        remaining = totalTarget - (allocation.completedContainers || 0);

        const isPartialLastCarton = data.containersProduced === remaining;
        
        if (data.containersProduced % recipe.containersPerCarton !== 0 && !isPartialLastCarton) {
          throw new Error(
            `Units must be packed in full cartons. Each carton holds ${recipe.containersPerCarton} units. ` +
            `You entered ${data.containersProduced} which is not a multiple of ${recipe.containersPerCarton}.`
          );
        }
      }

      // Calculate bulk consumed
      const bulkConsumed = getFillPerContainer(recipe.fillAmount, recipe.fillUnit, allocation.allocatedBulkUnit)
        .times(data.containersProduced).toNumber();
      if (Math.abs(bulkConsumed * 1000 - Math.round(bulkConsumed * 1000)) > 1e-6) {
        throw new Error("Bulk consumption cannot be represented to three decimal places");
      }
      if (Number(allocation.actualBulkConsumed ?? 0) + bulkConsumed > Number(allocation.allocatedBulkQuantity) + 1e-9) {
        throw new Error("Packing output would consume more bulk than reserved for this job");
      }

      const [progressLog] = await tx
        .insert(packagingProgressLogs)
        .values({
          id: createId(),
          packagingAllocationId: allocation.id,
          containersProduced: data.containersProduced,
          bulkConsumed: bulkConsumed.toFixed(3),
          createdById: context.session.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Gather packaging materials to deduct
      const materialsToDeduct: {
        materialId: string;
        materialName: string;
        quantity: number;
        costPerUnit: number;
      }[] = [];

      // 1. Container packaging
      if (recipe.containerPackagingId) {
        const [containerPkg] = await tx
          .select()
          .from(packagingMaterials)
          .where(eq(packagingMaterials.id, recipe.containerPackagingId));

        if (containerPkg) {
          materialsToDeduct.push({
            materialId: containerPkg.id,
            materialName: containerPkg.name,
            quantity: data.containersProduced,
            costPerUnit: parseFloat(containerPkg.costPerUnit?.toString() || "0"),
          });
        }
      }

      // 2. Additional packaging
      const addPkgs = await tx.query.recipePackaging.findMany({
        where: eq(recipePackaging.recipeId, recipe.id),
        with: { packagingMaterial: true },
      });

      for (const pkg of addPkgs) {
        const perCarton = recipe.containersPerCarton ?? 0;
        const cartonDelta = perCarton > 0
          ? Math.ceil((completedBefore + data.containersProduced) / perCarton) - Math.ceil(completedBefore / perCarton)
          : 0;
        const qtyNeeded = Number(pkg.quantityPerContainer) * (
          normalizePackagingUsageBasis(pkg.usageBasis) === "per_carton" ? cartonDelta : data.containersProduced
        );

        if (qtyNeeded <= 0) continue;

        materialsToDeduct.push({
          materialId: pkg.packagingMaterialId,
          materialName: pkg.packagingMaterial.name,
          quantity: qtyNeeded,
          costPerUnit: parseFloat(pkg.packagingMaterial.costPerUnit?.toString() || "0"),
        });
      }

      
      // 3. Carton packaging
      if (recipe.containersPerCarton && recipe.containersPerCarton > 0 && recipe.cartonPackagingId) {
        const [cartonPkg] = await tx
          .select()
          .from(packagingMaterials)
          .where(eq(packagingMaterials.id, recipe.cartonPackagingId));

        if (cartonPkg) {
          const cartonsNeeded = Math.ceil((completedBefore + data.containersProduced) / recipe.containersPerCarton)
            - Math.ceil(completedBefore / recipe.containersPerCarton);
          if (cartonsNeeded > 0) {
            materialsToDeduct.push({
              materialId: cartonPkg.id,
              materialName: cartonPkg.name,
              quantity: cartonsNeeded,
              costPerUnit: parseFloat(cartonPkg.costPerUnit?.toString() || "0"),
            });
          }
        }
      }

      let incrementalPkgCost = new Big(0);

      // One guarded debit per material prevents duplicate BOM rows and concurrent jobs
      // from consuming the same balance twice.
      const required = new Map<string, { name: string; quantity: number; costPerUnit: number }>();
      for (const mat of materialsToDeduct) {
        const prior = required.get(mat.materialId);
        required.set(mat.materialId, {
          name: mat.materialName,
          quantity: (prior?.quantity ?? 0) + mat.quantity,
          costPerUnit: mat.costPerUnit,
        });
      }
      for (const [materialId, mat] of [...required].sort(([left], [right]) => left.localeCompare(right))) {
        if (Math.abs(mat.quantity * 1000 - Math.round(mat.quantity * 1000)) > 1e-6) {
          throw new Error(`Material quantity for ${mat.name} exceeds stock precision`);
        }
        const quantityUsed = mat.quantity.toFixed(3);
        const [deducted] = await tx.update(materialStock)
          .set({ quantity: sql`${materialStock.quantity} - ${quantityUsed}`, updatedAt: new Date() })
          .where(and(
            eq(materialStock.warehouseId, allocation.warehouseId),
            eq(materialStock.packagingMaterialId, materialId),
            gte(materialStock.quantity, quantityUsed),
          ))
          .returning({ id: materialStock.id });
        if (!deducted) throw new Error(`Insufficient factory floor stock for ${mat.name}`);

        const materialCost = new Big(quantityUsed).times(mat.costPerUnit).toFixed(2);
        incrementalPkgCost = incrementalPkgCost.plus(materialCost);

        await tx.insert(packagingMaterialsUsed).values({
          id: createId(),
          packagingAllocationId: allocation.id,
          progressLogId: progressLog.id,
          materialId,
          quantityUsed,
          costPerUnit: mat.costPerUnit.toFixed(4),
          totalCost: materialCost,
        });
        await tx.insert(inventoryAuditLog).values({
          warehouseId: allocation.warehouseId,
          materialType: "packaging",
          materialId,
          type: "debit",
          amount: quantityUsed,
          reason: `Packing job ${allocation.id} progress`,
          performedById: context.session.user.id,
          referenceId: allocation.id,
        });
      }

      // Update packaging allocation
      await tx
        .update(packagingAllocations)
        .set({
          completedContainers: sql`${packagingAllocations.completedContainers} + ${data.containersProduced}`,
          actualBulkConsumed: sql`${packagingAllocations.actualBulkConsumed} + ${bulkConsumed.toFixed(3)}`,
          totalPackagingCost: sql`${packagingAllocations.totalPackagingCost} + ${incrementalPkgCost.toFixed(2)}`,
          updatedAt: new Date(),
        })
        .where(eq(packagingAllocations.id, allocation.id));

      if (completedBefore + data.containersProduced === allocation.targetContainers) {
        await completePackagingAllocationCore(tx, allocation.id, context.session.user.id);
      }

      return {
        success: true,
        progressLog, mixingRunId: allocation.mixingRunId,
      };
    });
  });
