import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { chemicals, materialStock, purchaseRecords, suppliers, user, warehouses } from "@/db";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";

/**
 * A supplier, a chemical, a store and a buyer, plus `buy` to record a purchase through the real
 * add-stock server function. The calling suite must mock `@tanstack/react-start` (createServerFn),
 * `@/lib/middlewares` and `@/lib/activity-logger.server`, as supplier-returns.test.ts does.
 */
const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

export async function supplierReturnFixture(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: `${id}-Ali Traders` }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "500" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  // Rows made in one transaction share created_at, so pick the purchase this call added.
  const bought = new Set<string>();
  const buy = async (quantity: string, cost: string) => {
    await addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
    const rows = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    const added = rows.find((row) => !bought.has(row.id));
    if (!added) throw new Error("Purchase was not recorded");
    bought.add(added.id);
    return added;
  };
  const stock = async () => {
    const [row] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, soda.id)));
    return row?.quantity ?? "0";
  };
  return { actor, floor, supplier, soda, context, buy, stock };
}
