import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, eq, sql } from "drizzle-orm";
import { chemicals, inventoryAuditLog, materialLotStock, packagingMaterials, purchaseRecords, suppliers, transactions, wallets, warehouses } from "@/db";
import { creditNoteCounters } from "@/db/schemas/sales-erp-schema";
import { supplierCreditMovements, supplierReturns } from "@/db/schemas/supplier-schema";
import type { MaterialRef } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { packagingUnit } from "@/lib/inventory/material-units";
import { purchaseStockLeft } from "@/lib/suppliers/purchase-rows.server";
import {
  formatDebitNoteNumber,
  formatSupplierReturnNumber,
  maxReturnable,
  planLeftover,
  purchaseOwed,
  splitDebitNote,
  supplierReturnValue,
} from "./supplier-returns";

export type Returnable = {
  purchaseId: string;
  supplierId: string;
  supplierName: string;
  materialName: string;
  unit: string;
  warehouseName: string;
  unitCost: string;
  stockLeft: string;
  pendingRequested: string;
  max: string;
  blockedReason: string | null;
};

/** Shares the credit-note counter table; each series has its own row id. */
export async function allocateCounterNumber(tx: Tx, counterId: "supplier_return" | "debit_note"): Promise<number> {
  await tx.insert(creditNoteCounters).values({ id: counterId, lastNumber: 0 }).onConflictDoNothing();
  const [counter] = await tx.select().from(creditNoteCounters).where(eq(creditNoteCounters.id, counterId)).for("update");
  const next = Number(counter?.lastNumber ?? 0) + 1;
  await tx.update(creditNoteCounters).set({ lastNumber: next, updatedAt: new Date() }).where(eq(creditNoteCounters.id, counterId));
  return next;
}

export const nextSupplierReturnNumber = async (tx: Tx) => formatSupplierReturnNumber(await allocateCounterNumber(tx, "supplier_return"));
export const nextDebitNoteNumber = async (tx: Tx) => formatDebitNoteNumber(await allocateCounterNumber(tx, "debit_note"));

const trimQty = (value: string) => new Big(value).toString(); // "100.000" -> "100" for messages

async function loadPurchase(tx: Tx, purchaseId: string, lock: boolean) {
  const base = tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchaseId));
  const [purchase] = lock ? await base.for("update") : await base;
  if (!purchase) throw new Error("Purchase record not found");
  return purchase;
}

async function describePurchase(tx: Tx, purchase: typeof purchaseRecords.$inferSelect) {
  const [supplier] = await tx.select({ name: suppliers.supplierName }).from(suppliers).where(eq(suppliers.id, purchase.supplierId));
  const [store] = await tx.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, purchase.warehouseId));
  let materialName = "Material";
  let unit = "units";
  if (purchase.chemicalId) {
    const [row] = await tx.select({ name: chemicals.name, unit: chemicals.unit }).from(chemicals).where(eq(chemicals.id, purchase.chemicalId));
    materialName = row?.name ?? materialName;
    unit = row?.unit ?? "kg";
  } else if (purchase.packagingMaterialId) {
    const [row] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.id, purchase.packagingMaterialId));
    if (row) {
      materialName = row.name;
      unit = packagingUnit(row);
    }
  }
  return { supplierName: supplier?.name ?? "Supplier", warehouseName: store?.name ?? "Store", materialName, unit };
}

/** Quantity of this purchase already asked for but not yet taken out of stock. */
async function pendingRequested(tx: Tx, purchaseId: string, exceptReturnId?: string) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierReturns.quantity}), 0)` })
    .from(supplierReturns)
    .where(and(
      eq(supplierReturns.purchaseId, purchaseId),
      eq(supplierReturns.status, "requested"),
      exceptReturnId ? sql`${supplierReturns.id} <> ${exceptReturnId}` : undefined,
    ));
  return new Big(row?.total ?? 0).toFixed(3);
}

async function storeLotStock(tx: Tx, lotId: string, warehouseId: string) {
  const [row] = await tx.select({ quantity: materialLotStock.quantity }).from(materialLotStock)
    .where(and(eq(materialLotStock.lotId, lotId), eq(materialLotStock.warehouseId, warehouseId)));
  return row?.quantity ?? "0";
}

async function returnableFor(tx: Tx, purchase: typeof purchaseRecords.$inferSelect, exceptReturnId?: string): Promise<Returnable> {
  const info = await describePurchase(tx, purchase);
  const base = { purchaseId: purchase.id, supplierId: purchase.supplierId, ...info, unitCost: new Big(purchase.unitCost).toFixed(2) };
  const blocked = (blockedReason: string): Returnable => ({ ...base, stockLeft: "0.000", pendingRequested: "0.000", max: "0.000", blockedReason });
  if (purchase.voidedAt) return blocked("A voided purchase can't be returned.");
  if (!purchase.lotId) return blocked("This purchase was recorded before price lots, so it can't be returned here. Use Adjust stock instead.");

  const left = (await purchaseStockLeft(tx, [purchase])).get(purchase.id) ?? 0;
  const stockLeft = new Big(left ?? 0).toFixed(3);
  const pending = await pendingRequested(tx, purchase.id, exceptReturnId);
  const max = maxReturnable({ stockLeft, storeStock: await storeLotStock(tx, purchase.lotId, purchase.warehouseId), pendingRequested: pending });
  return { ...base, stockLeft, pendingRequested: pending, max, blockedReason: new Big(max).gt(0) ? null : `Nothing of this purchase is left in ${info.warehouseName} to return.` };
}

export async function returnableForPurchase(tx: Tx, purchaseId: string): Promise<Returnable> {
  return returnableFor(tx, await loadPurchase(tx, purchaseId, false));
}

const QTY = /^\d+(\.\d{1,3})?$/;

export async function requestSupplierReturn(
  tx: Tx,
  input: { purchaseId: string; quantity: string; reason: string; notes?: string | null },
  actorId: string,
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Say why the goods are going back");
  if (!QTY.test(input.quantity) || new Big(input.quantity).lte(0)) throw new Error("Enter a quantity above 0 with at most 3 decimals");

  const purchase = await loadPurchase(tx, input.purchaseId, true);
  const returnable = await returnableFor(tx, purchase);
  if (returnable.blockedReason) throw new Error(returnable.blockedReason);
  const quantity = new Big(input.quantity);
  if (quantity.gt(returnable.max)) {
    throw new Error(`Only ${trimQty(returnable.max)} ${returnable.unit} of this purchase can be returned`);
  }

  const returnNumber = await nextSupplierReturnNumber(tx);
  const totalAmount = supplierReturnValue(quantity.toFixed(3), purchase.unitCost);
  const [created] = await tx.insert(supplierReturns).values({
    returnNumber,
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    warehouseId: purchase.warehouseId,
    lotId: purchase.lotId!,
    materialType: purchase.materialType,
    chemicalId: purchase.chemicalId,
    packagingMaterialId: purchase.packagingMaterialId,
    quantity: quantity.toFixed(3),
    unitCost: new Big(purchase.unitCost).toFixed(2),
    totalAmount,
    reason,
    notes: input.notes?.trim() || null,
    requestedById: actorId,
  }).returning({ id: supplierReturns.id });
  return { id: created.id, returnNumber, totalAmount };
}

function refOf(row: typeof supplierReturns.$inferSelect): MaterialRef {
  return row.materialType === "chemical"
    ? { materialType: "chemical", materialId: row.chemicalId! }
    : { materialType: "packaging", materialId: row.packagingMaterialId! };
}

/** Out at dispatch; back on cancel-after-dispatch or void. Lot movements carry the purchase id. */
async function moveReturnStock(
  tx: Tx,
  row: typeof supplierReturns.$inferSelect,
  direction: "out" | "back",
  actorId: string,
  why: string,
) {
  const ref = refOf(row);
  await lockMaterialStock(tx, [row.warehouseId], [ref]);
  const quantity = new Big(row.quantity).toFixed(3);
  await moveLotStock(tx, {
    ref,
    lotId: row.lotId,
    warehouseId: row.warehouseId,
    delta: direction === "out" ? `-${quantity}` : quantity,
    sourceType: direction === "out" ? "supplier_return" : "supplier_return_undo",
    sourceId: row.purchaseId,
  });
  await tx.insert(inventoryAuditLog).values({
    warehouseId: row.warehouseId,
    materialType: row.materialType,
    materialId: ref.materialId,
    type: direction === "out" ? "debit" : "credit",
    amount: quantity,
    reason: why,
    performedById: actorId,
    referenceId: row.id,
    lotId: row.lotId,
  });
}

export async function dispatchSupplierReturn(tx: Tx, input: { returnId: string }, actorId: string) {
  const { row, purchase } = await lockReturn(tx, input.returnId);
  if (row.status !== "requested") throw new Error(`This return is already ${row.status}.`);
  const returnable = await returnableFor(tx, purchase, row.id);
  if (returnable.blockedReason && new Big(returnable.max).eq(0)) {
    throw new Error(`Only 0 ${returnable.unit} of this purchase is left to send back`);
  }
  if (new Big(row.quantity).gt(returnable.max)) {
    throw new Error(`Only ${trimQty(returnable.max)} ${returnable.unit} of this purchase is left to send back. Cancel this return and request a smaller one.`);
  }
  await moveReturnStock(tx, row, "out", actorId, `Return ${row.returnNumber} dispatched to ${returnable.supplierName}`);
  await tx.update(supplierReturns)
    .set({ status: "dispatched", dispatchedById: actorId, dispatchedAt: new Date(), updatedAt: new Date() })
    .where(eq(supplierReturns.id, row.id));
  return { returnNumber: row.returnNumber, quantity: new Big(row.quantity).toFixed(3) };
}

/** Locks the purchase first, then the return (the purchase-writer lock order). */
export async function lockReturn(tx: Tx, returnId: string) {
  const [peek] = await tx.select({ purchaseId: supplierReturns.purchaseId }).from(supplierReturns).where(eq(supplierReturns.id, returnId));
  if (!peek) throw new Error("Supplier return not found");
  const purchase = await loadPurchase(tx, peek.purchaseId, true);
  const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, returnId)).for("update");
  return { row, purchase };
}

export async function cancelSupplierReturn(tx: Tx, input: { returnId: string; reason: string }, actorId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required");
  const { row } = await lockReturn(tx, input.returnId);
  if (row.status !== "requested" && row.status !== "dispatched") {
    throw new Error(row.status === "completed" ? "This return is completed. Void the debit note instead." : `This return is already ${row.status}.`);
  }
  const stockRestored = row.status === "dispatched";
  if (stockRestored) await moveReturnStock(tx, row, "back", actorId, `Return ${row.returnNumber} cancelled: ${reason}`);
  await tx.update(supplierReturns)
    .set({ status: "cancelled", cancelledById: actorId, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
    .where(eq(supplierReturns.id, row.id));
  return { returnNumber: row.returnNumber, stockRestored };
}

export async function supplierCreditBalance(tx: Tx, supplierId: string): Promise<string> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierCreditMovements.amount}), 0)` })
    .from(supplierCreditMovements)
    .where(eq(supplierCreditMovements.supplierId, supplierId));
  return new Big(row?.total ?? 0).toFixed(2);
}

export async function previewDebitNote(tx: Tx, returnId: string) {
  const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, returnId));
  if (!row) throw new Error("Supplier return not found");
  const purchase = await loadPurchase(tx, row.purchaseId, false);
  const owed = purchaseOwed(purchase);
  const split = splitDebitNote({ value: row.totalAmount, owed });
  const [supplier] = await tx.select({ name: suppliers.supplierName }).from(suppliers).where(eq(suppliers.id, row.supplierId));
  return { value: new Big(row.totalAmount).toFixed(2), owedBefore: owed.toFixed(2), ...split, supplierName: supplier?.name ?? "Supplier" };
}

export async function completeSupplierReturn(
  tx: Tx,
  input: { returnId: string; cashBack?: string | null; refundWalletId?: string | null },
  actorId: string,
) {
  const { row, purchase } = await lockReturn(tx, input.returnId);
  if (row.status === "requested") throw new Error("Mark it as dispatched first.");
  if (row.status !== "dispatched") throw new Error(`This return is already ${row.status}.`);

  const split = splitDebitNote({ value: row.totalAmount, owed: purchaseOwed(purchase) });
  const leftover = planLeftover({ leftover: split.leftover, cashBack: input.cashBack });
  const refund = new Big(leftover.refund);
  let refundWalletId: string | null = null;
  let refundTransactionId: string | null = null;
  const debitNoteNumber = await nextDebitNoteNumber(tx);
  const [supplier] = await tx.select({ name: suppliers.supplierName }).from(suppliers).where(eq(suppliers.id, row.supplierId));
  const supplierName = supplier?.name ?? "supplier";

  if (refund.gt(0)) {
    if (!input.refundWalletId) throw new Error("Pick the account the cash back goes into");
    const [wallet] = await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, input.refundWalletId)).for("update");
    if (!wallet) throw new Error("Pick the account the cash back goes into");
    refundWalletId = wallet.id;
    refundTransactionId = createId();
    await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${leftover.refund}` }).where(eq(wallets.id, wallet.id));
    await tx.insert(transactions).values({
      id: refundTransactionId,
      walletId: wallet.id,
      type: "credit",
      amount: leftover.refund,
      source: "Supplier Refund",
      referenceId: row.id,
      description: `Cash back for debit note ${debitNoteNumber} from ${supplierName}`,
      performedById: actorId,
    });
  }

  if (new Big(split.applied).gt(0)) {
    await tx.update(purchaseRecords)
      .set({ returnedAmount: sql`${purchaseRecords.returnedAmount} + ${split.applied}`, updatedAt: new Date() })
      .where(eq(purchaseRecords.id, purchase.id));
  }

  // Status first: the movement's return must already satisfy the debit-note check if it is read back.
  await tx.update(supplierReturns).set({
    status: "completed",
    completedById: actorId,
    completedAt: new Date(),
    debitNoteNumber,
    appliedToPurchaseAmount: split.applied,
    refundAmount: leftover.refund,
    refundWalletId,
    refundTransactionId,
    supplierCreditAmount: leftover.credit,
    updatedAt: new Date(),
  }).where(eq(supplierReturns.id, row.id));

  if (new Big(leftover.credit).gt(0)) {
    await tx.insert(supplierCreditMovements).values({
      supplierId: row.supplierId,
      kind: "issued",
      amount: leftover.credit,
      supplierReturnId: row.id,
      purchaseId: purchase.id,
      note: `Debit note ${debitNoteNumber}`,
      performedById: actorId,
    });
  }

  return { debitNoteNumber, applied: split.applied, refund: leftover.refund, credit: leftover.credit };
}
