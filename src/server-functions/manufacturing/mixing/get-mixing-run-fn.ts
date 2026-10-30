import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireProductionWorkReadMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { z } from "zod";

const getMixingRunSchema = z.object({
  id: z.string().min(1, "Mixing batch ID is required"),
});

export const getMixingRunFn = createServerFn()
  .middleware([requireProductionWorkReadMiddleware])
  .inputValidator(getMixingRunSchema)
  .handler(async ({ data, context }) => {
    const mixingRun = await db.query.mixingRuns.findFirst({
      where: (runs, { eq }) => eq(runs.id, data.id),
      with: {
        formula: {
          with: {
            recipes: true,
            ingredients: {
              with: {
                chemical: true,
              },
            },
          },
        },
        warehouse: true,
        operator: true,
        initiator: true,
        closedByUser: true,
        progressLogs: {
          with: {
            createdBy: true,
          },
          orderBy: (logs, { desc }) => [desc(logs.createdAt)],
        },
        materialsUsed: {
          with: {
            chemical: true,
          },
        },
        packagingAllocations: {
          with: {
            mixingRun: true,
            recipe: true,
            operator: true,
          },
          orderBy: (allocations, { desc }) => [desc(allocations.createdAt)],
        },
      },
    });

    if (!mixingRun) {
      throw new Error("Mixing batch not found");
    }
    if (mixingRun.operatorId !== context.session.user.id &&
        !hasPermission(context.authContext.permissions, "manufacturing.run.manage") &&
        !hasPermission(context.authContext.permissions, "manufacturing.run.read") &&
        !hasPermission(context.authContext.permissions, "manufacturing.view")) {
      throw new Error("This mixing batch is assigned to another operator");
    }

    // Operators run the batch but never see what it costs.
    const seesCosts = hasPermission(context.authContext.permissions, "manufacturing.run.manage") || hasPermission(context.authContext.permissions, "manufacturing.run.read") || hasPermission(context.authContext.permissions, "manufacturing.view");
    if (!seesCosts) {
      const noChemicalCost = <T extends { costPerUnit: string | null }>(chemical: T) => ({ ...chemical, costPerUnit: "0" });
      return {
        ...mixingRun, totalChemicalCost: null, chemicalCostPerUnit: null,
        formula: { ...mixingRun.formula, estimatedIngredientsCost: null, ingredients: mixingRun.formula.ingredients.map((row) => ({ ...row, chemical: noChemicalCost(row.chemical) })) },
        materialsUsed: mixingRun.materialsUsed.map((row) => ({ ...row, costPerUnit: "0", totalCost: "0", chemical: noChemicalCost(row.chemical) })),
        packagingAllocations: mixingRun.packagingAllocations.map((row) => ({
          ...row, allocatedChemicalCost: "0", totalPackagingCost: "0", totalProductionCost: "0", actualCostPerPack: "0", actualCostPerCarton: "0",
          mixingRun: { ...row.mixingRun, totalChemicalCost: null, chemicalCostPerUnit: null },
        })),
      };
    }

    return mixingRun;
  });
