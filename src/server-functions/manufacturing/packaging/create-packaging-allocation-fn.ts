import Big from "big.js";
import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { packagingAllocations, mixingRuns } from "@/db/schemas/production-schema";
import { recipes, warehouses } from "@/db/schemas/inventory-schema";
import { getProductionOperators } from "@/lib/production/operator-assignment.server";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { packingAvailability } from "./batch-packing-core.server";
import { getPackagingTarget } from "@/lib/production/packaging-quantity";

const createPackagingAllocationSchema = z.object({
  mixingRunId: z.string().min(1),
  recipeId: z.string().min(1),
  allocatedBulkQuantity: z.number().finite().positive(),
  operatorId: z.string().min(1),
});

export const createPackagingAllocationFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(createPackagingAllocationSchema)
  .handler(async ({ data, context }) => {
    if (
      !hasPermission(
        context.authContext.permissions,
        "manufacturing.run.manage",
      )
    ) {
      throw new Error("You do not have permission to manage production work.");
    }

    return await db.transaction(async (tx) => {
      // Fetch mixing run
      const [mixingRun] = await tx
        .select()
        .from(mixingRuns)
        .where(eq(mixingRuns.id, data.mixingRunId))
        .for("update");

      if (!mixingRun) {
        throw new Error("Mixing batch not found");
      }

      if (mixingRun.status !== "completed") {
        throw new Error("Complete the mixing batch before creating a packing job");
      }
      const [warehouse] = await tx.select().from(warehouses).where(eq(warehouses.id, mixingRun.warehouseId)).for("share");
      if (!warehouse?.isActive || warehouse.type !== "factory_floor") throw new Error("An active factory floor warehouse is required");
      if (Math.abs(data.allocatedBulkQuantity * 1000 - Math.round(data.allocatedBulkQuantity * 1000)) > 1e-6) {
        throw new Error("Quantity to pack supports up to three decimal places");
      }

      // Fetch recipe
      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, data.recipeId))
        .for("share");

      if (!recipe || !recipe.isActive || recipe.formulaId !== mixingRun.formulaId) {
        throw new Error("An active packaging format linked to the mixing formula is required");
      }
      const [operator] = await getProductionOperators(tx, data.operatorId);
      if (!operator) throw new Error("An active packaging operator is required");

      const targetContainers = getPackagingTarget(data.allocatedBulkQuantity, recipe.fillAmount, recipe.fillUnit, mixingRun.bulkUnit);

      // Check how much bulk is already allocated
      const allocations = await tx
        .select({
          totalAllocated: sql<number>`COALESCE(SUM(allocated_bulk_quantity), 0)`,
        })
        .from(packagingAllocations)
        .where(and(eq(packagingAllocations.mixingRunId, data.mixingRunId), ne(packagingAllocations.status, "cancelled")));

      const totalAllocated = Number(allocations[0]?.totalAllocated) || 0;
      const actualBulkProduced = Number(mixingRun.actualBulkProduced) || 0;
      
      // Allow if actualBulkProduced is greater than what's allocated + new allocation
      if ((await packingAvailability(tx, mixingRun)).lt(data.allocatedBulkQuantity)) {
        throw new Error(
          `Insufficient bulk available. Produced: ${actualBulkProduced}, Reserved for packing: ${totalAllocated}, Requested: ${data.allocatedBulkQuantity}`,
        );
      }

      // Calculate chemical cost for this allocation
      const totalChemicalCost = Number(mixingRun.totalChemicalCost) || 0;
      const allocatedChemicalCost = actualBulkProduced > 0 
        ? (data.allocatedBulkQuantity / actualBulkProduced) * totalChemicalCost 
        : 0;

      // Calculate targets
      // Convert fillAmount to liters or kg if necessary based on fillUnit vs bulkUnit
      // Standard assumption: if bulk is liters and fill is ml, convert.
      if (targetContainers < 1) {
        throw new Error("Quantity to pack is less than one container fill");
      }

      const containersPerCarton = recipe.containersPerCarton || 0;
      let targetCartons = 0;
      let targetLooseUnits = targetContainers;

      if (containersPerCarton > 0 && recipe.cartonPackagingId) {
        targetCartons = Math.floor(targetContainers / containersPerCarton);
        targetLooseUnits = targetContainers % containersPerCarton;
      }

      const [newAllocation] = await tx
        .insert(packagingAllocations)
        .values({
          id: createId(),
          mixingRunId: data.mixingRunId,
          recipeId: data.recipeId,
          warehouseId: mixingRun.warehouseId,
          operatorId: data.operatorId,
          initiatorId: context.session.user.id,
          allocatedBulkQuantity: data.allocatedBulkQuantity.toFixed(3),
          allocatedBulkUnit: mixingRun.bulkUnit,
          allocatedChemicalCost: allocatedChemicalCost.toFixed(2),
          targetContainers,
          targetCartons,
          targetLooseUnits,
          status: "allocated",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return {
        success: true,
        allocation: newAllocation, mixingRunId: newAllocation.mixingRunId,
      };
    });
  });
