import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/schemas/auth-schema";
import { wallets } from "@/db/schemas/finance-schema";
import { recipes, returnedFinishedGoodsStock, warehouses } from "@/db/schemas/inventory-schema";
import { returnedStockMovements } from "@/db/schemas/sales-erp-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { RETURNED_STOCK_MOVEMENT_LABELS, returnedPacking, type ReturnedCondition } from "@/lib/inventory/returned-stock";
import {
  scrapReturnedStock,
  sellReturnedStock,
  setReturnedStockValue,
  voidReturnedStockMovement,
} from "@/lib/inventory/returned-stock.server";
import { requireInventoryViewMiddleware, requireReturnsDisposeMiddleware } from "@/lib/middlewares";

const stockKey = {
  warehouseId: z.string().min(1),
  recipeId: z.string().min(1),
  condition: z.enum(["damaged", "expired"]),
};
const packs = z.number().int("Packs must be a whole number").positive("Pick at least 1 pack.").max(999_999);
const rupees = (label: string) =>
  z
    .number()
    .finite()
    .max(1_000_000)
    .refine((value) => new Big(value).round(2).eq(value), `${label} can have at most 2 decimals (paisa)`);
const note = z.string().trim().max(500).optional();

type Actor = { session: { user: { id: string } }; authContext: { session: { user: { id: string; name: string } } } };
function logMovement(context: Actor, action: "created" | "deleted", entityId: string, description: string) {
  logActivityQuiet({
    module: "inventory",
    action,
    entityType: "returned_stock_movement",
    entityId,
    actorId: context.authContext.session.user.id,
    actorName: context.authContext.session.user.name,
    description,
  });
}

export const getReturnedStockFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .inputValidator(z.object({}).optional())
  .handler(async () => {
    const { db } = await import("@/db");
    const stock = await db
      .select({
        warehouseId: returnedFinishedGoodsStock.warehouseId,
        warehouseName: warehouses.name,
        recipeId: returnedFinishedGoodsStock.recipeId,
        recipeName: recipes.name,
        condition: returnedFinishedGoodsStock.condition,
        quantityCartons: returnedFinishedGoodsStock.quantityCartons,
        quantityContainers: returnedFinishedGoodsStock.quantityContainers,
        totalInventoryValue: returnedFinishedGoodsStock.totalInventoryValue,
        cartonPackagingId: recipes.cartonPackagingId,
        containersPerCarton: recipes.containersPerCarton,
      })
      .from(returnedFinishedGoodsStock)
      .innerJoin(warehouses, eq(returnedFinishedGoodsStock.warehouseId, warehouses.id))
      .innerJoin(recipes, eq(returnedFinishedGoodsStock.recipeId, recipes.id))
      .orderBy(asc(recipes.name), asc(warehouses.name), asc(returnedFinishedGoodsStock.condition));
    const rows = stock
      .map((row) => {
        const { unitsPerCarton } = returnedPacking(row);
        return {
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          recipeId: row.recipeId,
          recipeName: row.recipeName,
          condition: row.condition as ReturnedCondition,
          units: row.quantityCartons * unitsPerCarton + row.quantityContainers,
          unitsPerCarton,
          value: new Big(row.totalInventoryValue ?? 0).toFixed(2),
        };
      })
      .filter((row) => row.units > 0 || Number(row.value) !== 0);

    const voider = alias(user, "returned_stock_voider");
    const movements = await db
      .select({
        id: returnedStockMovements.id,
        kind: returnedStockMovements.kind,
        recipeName: recipes.name,
        warehouseName: warehouses.name,
        condition: returnedStockMovements.condition,
        units: returnedStockMovements.units,
        valueRemoved: returnedStockMovements.valueRemoved,
        unitPrice: returnedStockMovements.unitPrice,
        saleAmount: returnedStockMovements.saleAmount,
        lossAmount: returnedStockMovements.lossAmount,
        walletName: wallets.name,
        note: returnedStockMovements.note,
        movementDate: returnedStockMovements.movementDate,
        performedByName: user.name,
        voidedAt: returnedStockMovements.voidedAt,
        voidedByName: voider.name,
        voidReason: returnedStockMovements.voidReason,
      })
      .from(returnedStockMovements)
      .innerJoin(recipes, eq(returnedStockMovements.recipeId, recipes.id))
      .innerJoin(warehouses, eq(returnedStockMovements.warehouseId, warehouses.id))
      .leftJoin(wallets, eq(returnedStockMovements.walletId, wallets.id))
      .leftJoin(user, eq(returnedStockMovements.performedById, user.id))
      .leftJoin(voider, eq(returnedStockMovements.voidedById, voider.id))
      .orderBy(desc(returnedStockMovements.movementDate), desc(returnedStockMovements.createdAt))
      .limit(100);
    return { rows, movements };
  });

/** Names only: people who sell seconds pick an account without seeing balances or needing finance access. */
export const getReturnedStockAccountsFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(z.object({}).optional())
  .handler(async () => {
    const { db } = await import("@/db");
    return db.select({ id: wallets.id, name: wallets.name }).from(wallets).orderBy(asc(wallets.createdAt));
  });

export const scrapReturnedStockFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(z.object({ ...stockKey, units: packs, note }))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => scrapReturnedStock(tx, { ...data, userId: context.session.user.id }));
    logMovement(context, "created", movement.id, `Scrapped ${data.units} ${data.condition} packs (loss Rs ${movement.lossAmount})`);
    return movement;
  });

export const sellReturnedStockFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(
    z.object({
      ...stockKey,
      units: packs,
      unitPrice: rupees("Price").pipe(z.number().positive("Price must be above zero")),
      walletId: z.string().min(1, "Please pick the account"),
      note,
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => sellReturnedStock(tx, { ...data, userId: context.session.user.id }));
    logMovement(context, "created", movement.id, `Sold ${data.units} ${data.condition} packs as seconds for Rs ${movement.saleAmount}`);
    return movement;
  });

export const setReturnedStockValueFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(
    z.object({
      ...stockKey,
      valuePerPack: rupees("Value per pack").pipe(z.number().min(0, "Value per pack can't be below zero.")),
      note: z.string().trim().min(3, "Say why the value changed (at least 3 characters).").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => setReturnedStockValue(tx, { ...data, userId: context.session.user.id }));
    logMovement(context, "created", movement.id, `Lowered ${data.condition} stock value by Rs ${movement.lossAmount}: ${data.note}`);
    return movement;
  });

export const voidReturnedStockMovementFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(
    z.object({
      movementId: z.string().min(1),
      reason: z.string().trim().min(3, "Give a reason for voiding (at least 3 characters).").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => voidReturnedStockMovement(tx, { ...data, userId: context.session.user.id }));
    const label = RETURNED_STOCK_MOVEMENT_LABELS[movement.kind as keyof typeof RETURNED_STOCK_MOVEMENT_LABELS] ?? movement.kind;
    logMovement(context, "deleted", movement.id, `Voided "${label}" entry: ${data.reason}`);
    return movement;
  });
