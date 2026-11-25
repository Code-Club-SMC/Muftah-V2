import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chemicals, purchaseRecords, suppliers, user, wallets, warehouses } from "@/db";
import { otherIncome, transactions } from "@/db/schemas/finance-schema";
import { eq } from "drizzle-orm";
import { assertEarnedCoversSold, loadItemByProducts } from "@/lib/inventory/by-products.server";
import { findOrCreateLot, lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { withRollback } from "./with-rollback";

// 10 Soda drums of 100kg bought, 350kg used (3 empties), all 3 sold.
async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Guard", email: `${id}@test.invalid` }).returning();
  const [warehouse] = await tx.insert(warehouses).values({ name: id, address: "T", city: "T", state: "T", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: id }).returning();
  const [chemical] = await tx.insert(chemicals).values({ name: id, unit: "kg", costPerUnit: "10" }).returning();
  const [wallet] = await tx.insert(wallets).values({ id, name: id, type: "cash", balance: "0" }).returning();
  const ref = { materialType: "chemical" as const, materialId: chemical.id };
  await lockMaterialStock(tx, [warehouse.id], [ref]);
  const lot = await findOrCreateLot(tx, ref, "10");
  const [purchase] = await tx.insert(purchaseRecords).values({
    supplierId: supplier.id, warehouseId: warehouse.id, materialType: "chemical", chemicalId: chemical.id, lotId: lot.id,
    quantity: "1000", cost: "10000", unitCost: "10", byProductTracked: true, containerName: "Drum", containerSize: "100",
  }).returning();
  const move = (delta: string) => moveLotStock(tx, { ref, lotId: lot.id, warehouseId: warehouse.id, delta, sourceType: "adjustment" });
  await move("1000");
  await move("-350");
  await tx.insert(transactions).values({ id, walletId: wallet.id, type: "credit", amount: "30", source: "By-Products", performedById: actor.id });
  await tx.insert(otherIncome).values({
    incomeDate: new Date(), itemName: "x", chemicalId: chemical.id, containerName: "Drum", containerSize: "100",
    quantity: "3", unitPrice: "10", amount: "30", walletId: wallet.id, transactionId: id, performedById: actor.id,
  });
  return { ref, purchase, move };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("sold empties guard", () => {
  it("counts earned, sold and in hand", () => withRollback(async (tx) => {
    const { ref } = await seed(tx);
    expect(await loadItemByProducts(tx, ref)).toMatchObject([{ earned: 3, sold: 3, inHand: 0 }]);
  }));

  it("refuses a change that leaves less earned than sold", () => withRollback(async (tx) => {
    const { ref, purchase } = await seed(tx);
    const before = await loadItemByProducts(tx, ref);
    await tx.update(purchaseRecords).set({ byProductTracked: false, containerName: null, containerSize: null }).where(eq(purchaseRecords.id, purchase.id));
    await expect(assertEarnedCoversSold(tx, ref, before)).rejects.toThrow("already sold");
  }));

  it("allows an unrelated edit when a count-over already made the item short", () => withRollback(async (tx) => {
    const { ref, purchase, move } = await seed(tx);
    await move("200");
    const before = await loadItemByProducts(tx, ref);
    expect(before).toMatchObject([{ earned: 1, sold: 3, inHand: -2 }]);
    await tx.update(purchaseRecords).set({ notes: "bill received" }).where(eq(purchaseRecords.id, purchase.id));
    await expect(assertEarnedCoversSold(tx, ref, before)).resolves.toBeUndefined();
  }));
});
