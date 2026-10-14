import Big from "big.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/authz.server";
import { chemicals, materialStock } from "@/db/schemas/inventory-schema";
import { formulaIngredients } from "@/db/schemas/production-schema";

export type MixingStockShortage = {
  chemicalId: string;
  name: string;
  unit: string;
  required: string;
  available: string;
  missing: string;
};

// Both scheduling and starting use the same requirements. Scheduling does not reserve stock.
export async function loadMixingStockRequirements(
  tx: Tx,
  formulaId: string,
  warehouseId: string,
) {
  const ingredients = await tx
    .select({
      chemicalId: formulaIngredients.chemicalId,
      name: chemicals.name,
      unit: chemicals.unit,
      quantity: formulaIngredients.quantityPerBatch,
      costPerUnit: chemicals.costPerUnit,
    })
    .from(formulaIngredients)
    .leftJoin(chemicals, eq(formulaIngredients.chemicalId, chemicals.id))
    .where(eq(formulaIngredients.formulaId, formulaId));

  if (!ingredients.length)
    throw new Error("Mixing formula has no chemical ingredients");
  const requirements = new Map<
    string,
    {
      chemicalId: string;
      name: string;
      unit: string;
      quantity: Big;
      costPerUnit: string;
    }
  >();
  for (const ingredient of ingredients) {
    if (!ingredient.name || !ingredient.unit)
      throw new Error("Mixing formula contains an unknown chemical");
    if (
      !Number.isFinite(Number(ingredient.quantity)) ||
      Number(ingredient.quantity) <= 0
    ) {
      throw new Error(`Invalid quantity for chemical "${ingredient.name}"`);
    }
    const prior = requirements.get(ingredient.chemicalId);
    requirements.set(ingredient.chemicalId, {
      chemicalId: ingredient.chemicalId,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: (prior?.quantity ?? new Big(0)).plus(ingredient.quantity),
      costPerUnit: ingredient.costPerUnit ?? "0",
    });
  }
  const materials = [...requirements.values()]
    .sort((a, b) => a.chemicalId.localeCompare(b.chemicalId))
    .map((material) => ({
      ...material,
      quantity: material.quantity.toFixed(3),
    }));
  // Lock in chemical order so simultaneous starts cannot overdraw the same stock.
  const stocks = await tx
    .select({
      chemicalId: materialStock.chemicalId,
      quantity: materialStock.quantity,
    })
    .from(materialStock)
    .where(
      and(
        eq(materialStock.warehouseId, warehouseId),
        inArray(
          materialStock.chemicalId,
          materials.map((material) => material.chemicalId),
        ),
      ),
    )
    .orderBy(asc(materialStock.chemicalId))
    .for("update");
  const availableByChemical = new Map(
    stocks.map((stock) => [stock.chemicalId, stock.quantity]),
  );
  const shortages: MixingStockShortage[] = [];
  for (const material of materials) {
    const available = new Big(
      availableByChemical.get(material.chemicalId) ?? "0",
    );
    if (available.lt(material.quantity))
      shortages.push({
        chemicalId: material.chemicalId,
        name: material.name,
        unit: material.unit,
        required: material.quantity,
        available: available.toFixed(3),
        missing: new Big(material.quantity).minus(available).toFixed(3),
      });
  }
  return { materials, shortages };
}

export function mixingStockShortageMessage(shortages: MixingStockShortage[]) {
  return `Insufficient factory floor stock. ${shortages
    .map(
      (item) =>
        `${item.name}: requires ${item.required} ${item.unit}, available ${item.available} ${item.unit}, missing ${item.missing} ${item.unit}`,
    )
    .join(
      "; ",
    )}. Transfer the missing chemicals to this factory floor and try again.`;
}
