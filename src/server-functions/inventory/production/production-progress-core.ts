import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  finishedGoodsStock,
  inventoryAuditLog,
  materialStock,
  packagingMaterials,
  productionMaterialsUsed,
  productionRuns,
  recipePackaging,
  recipes,
  warehouses,
  wacHistory,
} from "@/db/schemas/inventory-schema";
import { cartons } from "@/db/schemas/manufacturing-schema";
import {
  calculateActualRunCost,
  calculateNewWAC,
  calculateTotalInventoryValue,
  calculateTotalUnits,
  calculateWACPerCarton,
} from "@/lib/wac";
import { getActualPackagingQuantity } from "@/lib/recipe-packaging";

export type InventoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ProductionRunRow = typeof productionRuns.$inferSelect;
type RecipeRow = typeof recipes.$inferSelect;

type ProgressMaterial = {
  type: "chemical" | "packaging";
  materialId: string;
  materialName: string;
  quantity: number;
  costPerUnit: number;
};

export function validateProgressUnits(input: {
  run: ProductionRunRow;
  recipe: RecipeRow;
  unitsProduced: number;
}) {
  const currentCompleted = input.run.completedUnits || 0;
  const target = input.run.containersProduced;
  const remaining = target - currentCompleted;

  if (remaining <= 0) {
    throw new Error("Target already reached. Cannot log more units.");
  }

  if (input.unitsProduced > remaining) {
    throw new Error(
      `Cannot produce ${input.unitsProduced} units. Only ${remaining} units remaining to reach target of ${target}.`,
    );
  }

  if (
    input.recipe.cartonPackagingId &&
    input.recipe.containersPerCarton &&
    input.recipe.containersPerCarton > 0
  ) {
    const isPartialLastCarton =
      remaining < input.recipe.containersPerCarton &&
      input.unitsProduced === remaining;

    if (
      input.unitsProduced % input.recipe.containersPerCarton !== 0 &&
      !isPartialLastCarton
    ) {
      throw new Error(
        `Units must be packed in full cartons. Each carton holds ${input.recipe.containersPerCarton} units. ` +
          `You entered ${input.unitsProduced} which is not a multiple of ${input.recipe.containersPerCarton}.`,
      );
    }
  }
}

async function getFactoryFloorWarehouse(tx: InventoryTx) {
  const factoryFloor = await tx.query.warehouses.findFirst({
    where: eq(warehouses.type, "factory_floor"),
  });

  if (!factoryFloor) {
    throw new Error("Factory floor not found");
  }

  return factoryFloor;
}

async function buildPackagingDeductions(input: {
  tx: InventoryTx;
  recipe: RecipeRow;
  unitsProduced: number;
}) {
  const materialsToDeduct: ProgressMaterial[] = [];

  const containerPkg = await input.tx.query.packagingMaterials.findFirst({
    where: eq(packagingMaterials.id, input.recipe.containerPackagingId),
  });

  if (containerPkg) {
    materialsToDeduct.push({
      type: "packaging",
      materialId: containerPkg.id,
      materialName: containerPkg.name,
      quantity: input.unitsProduced,
      costPerUnit: parseFloat(containerPkg.costPerUnit?.toString() || "0"),
    });
  }

  const addPkgs = await input.tx.query.recipePackaging.findMany({
    where: eq(recipePackaging.recipeId, input.recipe.id),
    with: { packagingMaterial: true },
  });

  for (const pkg of addPkgs) {
    const qtyNeeded = getActualPackagingQuantity({
      quantityPerContainer: pkg.quantityPerContainer,
      usageBasis: pkg.usageBasis,
      actualUnits: input.unitsProduced,
      containersPerCarton: input.recipe.containersPerCarton,
    });

    if (qtyNeeded <= 0) {
      continue;
    }

    materialsToDeduct.push({
      type: "packaging",
      materialId: pkg.packagingMaterialId,
      materialName: pkg.packagingMaterial.name,
      quantity: qtyNeeded,
      costPerUnit: parseFloat(
        pkg.packagingMaterial.costPerUnit?.toString() || "0",
      ),
    });
  }

  if (
    input.recipe.cartonPackagingId &&
    input.recipe.containersPerCarton &&
    input.recipe.containersPerCarton > 0
  ) {
    const cartonPkg = await input.tx.query.packagingMaterials.findFirst({
      where: eq(packagingMaterials.id, input.recipe.cartonPackagingId),
    });

    if (cartonPkg) {
      const cartonsNeeded = Math.floor(
        input.unitsProduced / input.recipe.containersPerCarton,
      );

      if (cartonsNeeded > 0) {
        materialsToDeduct.push({
          type: "packaging",
          materialId: cartonPkg.id,
          materialName: cartonPkg.name,
          quantity: cartonsNeeded,
          costPerUnit: parseFloat(cartonPkg.costPerUnit?.toString() || "0"),
        });
      }
    }
  }

  return materialsToDeduct;
}

async function assertStockAvailability(input: {
  tx: InventoryTx;
  warehouseId: string;
  items: ProgressMaterial[];
}) {
  for (const item of input.items) {
    const stock = await input.tx.query.materialStock.findFirst({
      where: and(
        eq(materialStock.warehouseId, input.warehouseId),
        item.type === "chemical"
          ? eq(materialStock.chemicalId, item.materialId)
          : eq(materialStock.packagingMaterialId, item.materialId),
      ),
    });

    const available = parseFloat(stock?.quantity?.toString() || "0");
    if (available < item.quantity) {
      throw new Error(
        `Insufficient ${item.type} stock for ${item.materialName}. Available: ${available}, Required: ${item.quantity}.`,
      );
    }
  }
}

export async function applyProductionProgressLog(input: {
  tx: InventoryTx;
  run: ProductionRunRow;
  recipe: RecipeRow;
  unitsProduced: number;
  performedById: string;
  progressLogId?: string | null;
}) {
  validateProgressUnits({
    run: input.run,
    recipe: input.recipe,
    unitsProduced: input.unitsProduced,
  });

  const currentCompleted = input.run.completedUnits || 0;
  const target = input.run.containersProduced;
  const newCompletedUnits = currentCompleted + input.unitsProduced;
  const isNowComplete = newCompletedUnits >= target;
  const factoryFloor = await getFactoryFloorWarehouse(input.tx);

  const materialsToDeduct = await buildPackagingDeductions({
    tx: input.tx,
    recipe: input.recipe,
    unitsProduced: input.unitsProduced,
  });

  await assertStockAvailability({
    tx: input.tx,
    warehouseId: factoryFloor.id,
    items: materialsToDeduct,
  });

  let incrementalChemCost = 0;
  let incrementalPkgCost = 0;

  for (const item of materialsToDeduct) {
    const totalCost = item.quantity * item.costPerUnit;
    if (item.type === "chemical") {
      incrementalChemCost += totalCost;
    } else {
      incrementalPkgCost += totalCost;
    }

    await input.tx
      .update(materialStock)
      .set({
        quantity: sql`quantity - ${item.quantity}`,
      })
      .where(
        and(
          eq(materialStock.warehouseId, factoryFloor.id),
          item.type === "chemical"
            ? eq(materialStock.chemicalId, item.materialId)
            : eq(materialStock.packagingMaterialId, item.materialId),
        ),
      );

    await input.tx.insert(productionMaterialsUsed).values({
      productionRunId: input.run.id,
      materialType: item.type,
      materialId: item.materialId,
      progressLogId: input.progressLogId ?? null,
      quantityUsed: item.quantity.toString(),
      costPerUnit: item.costPerUnit.toString(),
      totalCost: totalCost.toString(),
    });
  }

  const updateData: Record<string, unknown> = {
    completedUnits: sql`COALESCE(${productionRuns.completedUnits}, 0) + ${input.unitsProduced}`,
    totalPackagingCost: sql`COALESCE(${productionRuns.totalPackagingCost}, 0) + ${incrementalPkgCost}`,
    totalProductionCost: sql`COALESCE(${productionRuns.totalProductionCost}, 0) + ${incrementalChemCost + incrementalPkgCost}`,
  };

  if (isNowComplete) {
    updateData.status = "completed";
    updateData.actualCompletionDate = new Date();

    const itemsPerCarton = input.recipe.containersPerCarton || 0;
    let finalCartons = 0;
    let finalLoose = newCompletedUnits;

    if (itemsPerCarton > 0 && input.recipe.cartonPackagingId) {
      finalCartons = Math.floor(newCompletedUnits / itemsPerCarton);
      finalLoose = newCompletedUnits % itemsPerCarton;
    }

    updateData.actualCartonsProduced = finalCartons;
    updateData.actualPacksProduced = newCompletedUnits;
    updateData.actualLooseUnitsProduced = finalLoose;

    const totalProdCost =
      parseFloat(input.run.totalProductionCost || "0") +
      incrementalChemCost +
      incrementalPkgCost;
    const costResult = calculateActualRunCost(
      totalProdCost,
      newCompletedUnits,
      finalCartons,
      finalLoose,
      input.run.plannedCartonsProduced ?? input.run.cartonsProduced ?? 0,
    );
    updateData.actualCostPerPack = costResult.actualCostPerPack.toFixed(4);
    updateData.actualCostPerCarton = costResult.actualCostPerCarton.toFixed(4);
    updateData.yieldVarianceCartons = costResult.yieldVarianceCartons;
  }

  await input.tx
    .update(productionRuns)
    .set(updateData)
    .where(eq(productionRuns.id, input.run.id));

  const existingStock = await input.tx.query.finishedGoodsStock.findFirst({
    where: and(
      eq(finishedGoodsStock.warehouseId, factoryFloor.id),
      eq(finishedGoodsStock.recipeId, input.recipe.id),
    ),
  });

  if (existingStock) {
    if (isNowComplete) {
      if (
        input.recipe.containersPerCarton &&
        input.recipe.containersPerCarton > 0 &&
        input.recipe.cartonPackagingId
      ) {
        const totalLooseInStock =
          existingStock.quantityContainers + input.unitsProduced;
        const cartonsFromLoose = Math.floor(
          totalLooseInStock / input.recipe.containersPerCarton,
        );
        const remainingLoose =
          totalLooseInStock % input.recipe.containersPerCarton;

        await input.tx
          .update(finishedGoodsStock)
          .set({
            quantityCartons: sql`${finishedGoodsStock.quantityCartons} + ${cartonsFromLoose}`,
            quantityContainers: remainingLoose,
            updatedAt: new Date(),
          })
          .where(eq(finishedGoodsStock.id, existingStock.id));
      } else {
        await input.tx
          .update(finishedGoodsStock)
          .set({
            quantityContainers: sql`${finishedGoodsStock.quantityContainers} + ${input.unitsProduced}`,
            updatedAt: new Date(),
          })
          .where(eq(finishedGoodsStock.id, existingStock.id));
      }
    } else {
      await input.tx
        .update(finishedGoodsStock)
        .set({
          quantityContainers: sql`${finishedGoodsStock.quantityContainers} + ${input.unitsProduced}`,
          updatedAt: new Date(),
        })
        .where(eq(finishedGoodsStock.id, existingStock.id));
    }
  } else {
    await input.tx.insert(finishedGoodsStock).values({
      warehouseId: factoryFloor.id,
      recipeId: input.recipe.id,
      quantityContainers: input.unitsProduced,
      quantityCartons: 0,
    });
  }

  if (isNowComplete) {
    const itemsPerCarton = input.recipe.containersPerCarton || 0;
    let finalCartons = 0;
    let finalLoose = newCompletedUnits;

    if (itemsPerCarton > 0 && input.recipe.cartonPackagingId) {
      finalCartons = Math.floor(newCompletedUnits / itemsPerCarton);
      finalLoose = newCompletedUnits % itemsPerCarton;
    }

    await input.tx.insert(inventoryAuditLog).values({
      warehouseId: factoryFloor.id,
      materialType: "finished",
      materialId: input.recipe.id,
      type: "credit",
      amount: newCompletedUnits.toString(),
      reason: `Production run ${input.run.batchId} auto-completed. ${finalCartons} Cartons, ${finalLoose} Loose.`,
      performedById: input.performedById,
      referenceId: input.run.id,
    });

    if (finalCartons > 0 && itemsPerCarton > 0 && input.recipe.cartonPackagingId) {
      const cartonInserts: (typeof cartons.$inferInsert)[] = [];

      for (let i = 0; i < finalCartons; i++) {
        cartonInserts.push({
          id: createId(),
          recipeId: input.run.recipeId,
          productionRunId: input.run.id,
          warehouseId: factoryFloor.id,
          sku: input.recipe.name,
          capacity: itemsPerCarton,
          currentPacks: itemsPerCarton,
          status: "COMPLETE",
        });
      }

      if (finalLoose > 0) {
        cartonInserts.push({
          id: createId(),
          recipeId: input.run.recipeId,
          productionRunId: input.run.id,
          warehouseId: factoryFloor.id,
          sku: input.recipe.name,
          capacity: itemsPerCarton,
          currentPacks: finalLoose,
          status: "PARTIAL",
        });
      }

      if (cartonInserts.length > 0) {
        await input.tx.insert(cartons).values(cartonInserts);
      }
    }
  }

  if (isNowComplete) {
    const containersPerCarton = input.recipe.containersPerCarton || 0;
    const wacFinalCartons =
      containersPerCarton > 0 && input.recipe.cartonPackagingId
        ? Math.floor(newCompletedUnits / containersPerCarton)
        : 0;
    const wacFinalLoose =
      containersPerCarton > 0 && input.recipe.cartonPackagingId
        ? newCompletedUnits % containersPerCarton
        : newCompletedUnits;
    const totalProdCost =
      parseFloat(input.run.totalProductionCost || "0") +
      incrementalChemCost +
      incrementalPkgCost;
    const costResult = calculateActualRunCost(
      totalProdCost,
      newCompletedUnits,
      wacFinalCartons,
      wacFinalLoose,
      input.run.plannedCartonsProduced ?? input.run.cartonsProduced ?? 0,
    );

    const [fgStock] = await input.tx
      .select()
      .from(finishedGoodsStock)
      .where(
        and(
          eq(finishedGoodsStock.warehouseId, factoryFloor.id),
          eq(finishedGoodsStock.recipeId, input.recipe.id),
        ),
      );

    if (fgStock) {
      const currentTotalUnits = calculateTotalUnits(
        fgStock.quantityCartons,
        fgStock.quantityContainers,
        containersPerCarton,
      );
      const currentWAC = parseFloat(
        fgStock.weightedAverageCostPerPack?.toString() || "0",
      );
      const newWAC = calculateNewWAC(
        currentTotalUnits - input.unitsProduced,
        currentWAC,
        input.unitsProduced,
        costResult.actualCostPerPack,
      );
      const newWACPerCarton = calculateWACPerCarton(
        newWAC,
        containersPerCarton,
      );
      const newTotalUnits = calculateTotalUnits(
        fgStock.quantityCartons,
        fgStock.quantityContainers,
        containersPerCarton,
      );
      const newTotalValue = calculateTotalInventoryValue(newTotalUnits, newWAC);

      await input.tx
        .update(finishedGoodsStock)
        .set({
          weightedAverageCostPerPack: newWAC.toFixed(4),
          weightedAverageCostPerCarton: newWACPerCarton.toFixed(4),
          totalInventoryValue: newTotalValue.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(finishedGoodsStock.id, fgStock.id));

      await input.tx.insert(wacHistory).values({
        id: createId(),
        recipeId: input.run.recipeId,
        warehouseId: input.run.warehouseId,
        wacPerPack: newWAC.toFixed(4),
        wacPerCarton: newWACPerCarton.toFixed(4),
        totalUnits: newTotalUnits,
        totalInventoryValue: newTotalValue.toFixed(2),
        productionRunId: input.run.id,
        effectiveDate: new Date(),
      });
    }
  }

  return { success: true, autoCompleted: isNowComplete };
}
