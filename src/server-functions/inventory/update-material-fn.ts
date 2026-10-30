import { createServerFn } from "@tanstack/react-start";
import { and, eq, gt } from "drizzle-orm";
import Big from "big.js";
import { db, packagingMaterials, chemicals, materialStock, materialLots, inventoryAuditLog, materialAdjustments } from "@/db";
import { lotQuantity } from "@/lib/inventory/material-lots";
import { packagingMaterialsUsed } from "@/db/schemas/production-schema";
import { lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const updateMaterialSchema = z.object({
  id: z.string(),
  type: z.enum(["chemical", "packaging"]),
  data: z.object({
    name: z.string().min(1),
    unit: z.string().optional(),
    costPerUnit: z.string().min(1),
    minimumStockLevel: z.union([z.string(), z.number()]),
    materialType: z.string().optional(), // Maps to 'type' in packaging_materials
    capacity: z.string().optional(),
    capacityUnit: z.string().optional(),
    measuredInKg: z.boolean().optional(),
    weightPerPack: z.string().optional(),
  }),
  // A new quantity for one store. The difference is taken from or added to the picked lot.
  stock: z.object({
    stockId: z.string().min(1),
    quantity: z.string().min(1),
    lotId: z.string().optional(),
  }).optional(),
});

// Old quantities must never change meaning, so the unit is fixed once stock or history exists.
export async function kgSwitchLocked(tx: Tx, materialId: string) {
  const [lot] = await tx.select({ id: materialLots.id }).from(materialLots).where(eq(materialLots.packagingMaterialId, materialId)).limit(1);
  const [stock] = await tx.select({ id: materialStock.id }).from(materialStock)
    .where(and(eq(materialStock.packagingMaterialId, materialId), gt(materialStock.quantity, "0"))).limit(1);
  const [used] = await tx.select({ id: packagingMaterialsUsed.id }).from(packagingMaterialsUsed).where(eq(packagingMaterialsUsed.materialId, materialId)).limit(1);
  return !!(lot || stock || used);
}

export const updateMaterialFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateMaterialSchema)
  .handler(async ({ data, context }) => {
    try {
      const { id, type, data: fields, stock } = data;

      return await db.transaction(async (tx) => {
        // Stock first, so stock from before lots becomes a lot at the old price, not the edited one.
        if (stock) {
          const ref = { materialType: type, materialId: id } as const;
          const [row] = await tx.select().from(materialStock).where(eq(materialStock.id, stock.stockId));
          if (!row || (type === "chemical" ? row.chemicalId : row.packagingMaterialId) !== id)
            throw new Error("Stock record not found for this item");
          await lockMaterialStock(tx, [row.warehouseId], [ref]);
          const [current] = await tx.select({ quantity: materialStock.quantity }).from(materialStock)
            .where(eq(materialStock.id, row.id));
          const delta = new Big(lotQuantity(stock.quantity, "Stock quantity")).minus(current.quantity);
          if (!delta.eq(0)) {
            if (!stock.lotId) throw new Error("Pick the lot this stock change belongs to");
            const [lot] = await tx.select().from(materialLots)
              .where(and(eq(materialLots.id, stock.lotId), eq(type === "chemical" ? materialLots.chemicalId : materialLots.packagingMaterialId, id)));
            if (!lot) throw new Error("This lot belongs to another item");
            await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: row.warehouseId, delta: delta.toFixed(3), sourceType: "adjustment", sourceId: null });
            // A quantity edit is a count, so it is saved as Count short or Count over.
            await tx.insert(materialAdjustments).values({
              warehouseId: row.warehouseId, materialType: type,
              chemicalId: type === "chemical" ? id : null,
              packagingMaterialId: type === "packaging" ? id : null,
              lotId: lot.id, delta: delta.toFixed(3), unitPrice: lot.unitPrice,
              value: delta.times(lot.unitPrice).round(2).toFixed(2),
              reason: delta.gt(0) ? "count_over" : "count_short", note: null, source: "material_edit", performedById: context.session.user.id,
            });
            await tx.insert(inventoryAuditLog).values({
              warehouseId: row.warehouseId,
              materialType: type,
              materialId: id,
              lotId: lot.id,
              type: delta.gt(0) ? "credit" : "debit",
              amount: delta.abs().toFixed(3),
              reason: `[MATERIAL EDIT] Stock set from ${new Big(current.quantity).toString()} to ${new Big(stock.quantity).toString()} | Material: ${fields.name}`,
              performedById: context.session.user.id,
            });
          }
        }

        if (type === "chemical") {
          await tx
            .update(chemicals)
            .set({
              name: fields.name,
              unit: fields.unit,
              costPerUnit: fields.costPerUnit,
              minimumStockLevel: fields.minimumStockLevel.toString(),
            })
            .where(eq(chemicals.id, id));
        } else {
          const [current] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.id, id)).for("update");
          if (!current) throw new Error("Packaging material not found");
          const measuredInKg = fields.measuredInKg ?? current.measuredInKg;
          const materialType = fields.materialType ?? current.type;
          if (measuredInKg !== current.measuredInKg && await kgSwitchLocked(tx, id))
            throw new Error("Measured in KG can't change once this material has stock or has been used.");
          if (measuredInKg && materialType !== "primary") throw new Error("Only primary packaging can be measured in KG");
          const weightPerPack = fields.weightPerPack ?? current.weightPerPack;
          if (measuredInKg && !(Number(weightPerPack) > 0)) throw new Error("Weight of one shopper (grams) is required");
          await tx
            .update(packagingMaterials)
            .set({
              name: fields.name,
              costPerUnit: fields.costPerUnit,
              minimumStockLevel: Number(fields.minimumStockLevel),
              type: fields.materialType,
              capacity: fields.capacity || null,
              capacityUnit: fields.capacityUnit || null,
              measuredInKg,
              weightPerPack: weightPerPack || null,
              ...(measuredInKg ? { pricePerKg: fields.costPerUnit } : {}),
            })
            .where(eq(packagingMaterials.id, id));
        }

        return { success: true };
      });
    } catch (error) {
      console.error("Update Error:", error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to update material.",
      );
    }
  });
