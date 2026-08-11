import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { customers, invoices } from "@/db/schemas/sales-schema";
import {
  discountRules,
  entityRecipeRates,
  orders,
} from "@/db/schemas/sales-erp-schema";
import {
  finishedGoodsStock,
  recipes,
  warehouses,
} from "@/db/schemas/inventory-schema";
import type { OfflineSalesReferenceSnapshot } from "./contracts";

type SalesTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | SalesTransaction;

const money = (value: string | number | null | undefined, scale = 2) =>
  Number(value ?? 0).toFixed(scale);

const iso = (value: Date | string) =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export async function buildOfflineSalesReferenceSnapshot(
  database: Database,
  generatedAt = new Date(),
): Promise<OfflineSalesReferenceSnapshot> {
  const factoryWarehouse = await database.query.warehouses.findFirst({
    where: eq(warehouses.type, "factory_floor"),
    columns: { id: true },
  });
  if (!factoryWarehouse) {
    throw new Error("Factory floor warehouse is required for offline sales");
  }

  const now = generatedAt;
  // This may run inside workbook-issuance transaction. One pg transaction
  // owns one client, so queries must not overlap.
  const customerRows = await database.query.customers.findMany({
        where: eq(customers.customerType, "distributor"),
        columns: {
          id: true,
          sNo: true,
          name: true,
          outstandingAmount: true,
          creditLimit: true,
          creditHold: true,
        },
      });
  const recipeRows = await database.query.recipes.findMany({
        where: eq(recipes.isActive, true),
        columns: {
          id: true,
          productId: true,
          name: true,
          containersPerCarton: true,
        },
        with: {
          product: { columns: { name: true } },
          finishedGoods: {
            where: eq(finishedGoodsStock.warehouseId, factoryWarehouse.id),
            columns: {
              quantityCartons: true,
              quantityContainers: true,
              weightedAverageCostPerPack: true,
            },
          },
        },
      });
  const rateRows = await database.query.entityRecipeRates.findMany({
        where: eq(entityRecipeRates.entityType, "distributor"),
      });
  const ruleRows = await database.query.discountRules.findMany({
        where: and(
          eq(discountRules.isActive, true),
          eq(discountRules.ruleType, "free_units"),
          lte(discountRules.effectiveFrom, now),
          or(
            isNull(discountRules.effectiveTo),
            gte(discountRules.effectiveTo, now),
          ),
        ),
      });
  const orderRows = await database.query.orders.findMany({
        where: inArray(orders.status, ["pending", "confirmed"]),
        with: { orderBooker: true, items: true },
      });
  const walletRows = await database.query.wallets.findMany();

  const defaultPriceRows = await database.query.recipePrices.findMany();
  const linkedInvoiceRows = orderRows.length > 0
      ? await database.query.invoices.findMany({
          where: inArray(
            invoices.orderId,
            orderRows.map((order) => order.id),
          ),
          columns: { orderId: true },
        })
      : ([] as Array<{ orderId: string | null }>);
  const linkedOrderIds = new Set(
    linkedInvoiceRows.flatMap((row) => (row.orderId ? [row.orderId] : [])),
  );
  const defaultPrices = new Map(
    defaultPriceRows.map((row) => [row.recipeId, row]),
  );
  const packsPerCartonByRecipe = new Map(
    recipeRows.map((recipe) => [
      recipe.id,
      Number(recipe.containersPerCarton ?? 0),
    ]),
  );
  const ratesByRecipe = new Map<string, typeof rateRows>();
  for (const rate of rateRows) {
    const existing = ratesByRecipe.get(rate.recipeId) ?? [];
    existing.push(rate);
    ratesByRecipe.set(rate.recipeId, existing);
  }

  return {
    generatedAt: generatedAt.toISOString(),
    factoryWarehouseId: factoryWarehouse.id,
    distributors: customerRows
      .map((customer) => ({
        id: customer.id,
        code: `D-${customer.sNo}`,
        name: customer.name,
        outstandingAmount: money(customer.outstandingAmount),
        creditLimit: money(customer.creditLimit),
        creditHold: Boolean(customer.creditHold),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    products: recipeRows
      .map((recipe) => {
        const packsPerCarton = Number(recipe.containersPerCarton ?? 0);
        const stock = recipe.finishedGoods[0];
        const defaultPrice = defaultPrices.get(recipe.id);
        return {
          recipeId: recipe.id,
          productId: recipe.productId,
          code: recipe.id,
          name: `${recipe.product.name} — ${recipe.name}`,
          packsPerCarton,
          distributorCartonPrice: money(
            Number(defaultPrice?.invoicePricePerPack ?? 0) * packsPerCarton,
          ),
          distributorPrices: (ratesByRecipe.get(recipe.id) ?? [])
            .map((rate) => ({
              customerId: rate.entityId,
              cartonPrice: money(rate.pricePerCarton),
            }))
            .sort((a, b) => a.customerId.localeCompare(b.customerId)),
          retailPricePerPack: money(defaultPrice?.retailPricePerPack),
          wacPerPack: money(stock?.weightedAverageCostPerPack, 4),
          stockUnits:
            Number(stock?.quantityCartons ?? 0) * packsPerCarton +
            Number(stock?.quantityContainers ?? 0),
        };
      })
      .filter((product) => product.packsPerCarton > 0)
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
    discountRules: ruleRows
      .filter((rule) => rule.recipeId != null)
      .map((rule) => ({
        id: rule.id,
        customerId: rule.customerId,
        recipeId: rule.recipeId!,
        quantityThreshold: Number(rule.quantityThreshold),
        freeCartons: Number(rule.freeUnits),
        effectiveFrom: iso(rule.effectiveFrom),
        effectiveTo: rule.effectiveTo ? iso(rule.effectiveTo) : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    orders: orderRows
      .filter(
        (order) =>
          !linkedOrderIds.has(order.id) &&
          order.items.length > 0 &&
          order.items.every((item) => item.recipeId != null),
      )
      .map((order) => ({
        id: order.id,
        orderBookerId: order.orderBookerId,
        orderBookerCode: order.orderBookerId,
        billNumber: order.billNumber,
        shopkeeperName: order.shopkeeperName,
        shopkeeperMobile: order.shopkeeperMobile,
        shopkeeperAddress: order.shopkeeperAddress,
        items: order.items
          .map((item) => ({
            recipeId: item.recipeId!,
            productCode: item.recipeId!,
            unitType: item.unitType,
            quantity: Number(item.quantity),
            rate: money(item.rate),
            cartonRate: money(
              item.unitType === "full_carton"
                ? Number(item.rate)
                : item.unitType === "half_carton"
                  ? Number(item.rate) * 2
                  : Number(item.rate) *
                    (packsPerCartonByRecipe.get(item.recipeId!) ?? 0),
            ),
          }))
          .sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
      }))
      .sort(
        (a, b) =>
          a.orderBookerCode.localeCompare(b.orderBookerCode) ||
          a.billNumber - b.billNumber,
      ),
    wallets: walletRows
      .filter((wallet) => wallet.type === "cash" || wallet.type === "bank")
      .map((wallet) => ({
        id: wallet.id,
        code: wallet.id,
        name: wallet.name,
        type: wallet.type as "cash" | "bank",
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
  };
}
