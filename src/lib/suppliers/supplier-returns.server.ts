import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chemicals, inventoryAuditLog, materialLotStock, packagingMaterials, purchaseRecords, supplierPayments, suppliers, transactions, user, wallets, warehouses } from "@/db";
import { creditNoteCounters } from "@/db/schemas/sales-erp-schema";
import { supplierCreditMovements, supplierReturns } from "@/db/schemas/supplier-schema";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { MaterialRef } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock, type Tx } from "@/lib/inventory/material-lots.server";
import { packagingUnit } from "@/lib/inventory/material-units";
import { purchaseStockLeft } from "@/lib/suppliers/purchase-rows.server";
import {
  ACTIVE_SUPPLIER_RETURN_STATUSES,
  QUEUE_STATUSES,
  SUPPLIER_CREDIT_METHOD,
  type SupplierReturnQueue,
  type SupplierReturnRow,
  type SupplierReturnStatus,
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

export async function voidSupplierReturn(tx: Tx, input: { returnId: string; reason: string }, actorId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required");
  const { row, purchase } = await lockReturn(tx, input.returnId);
  if (row.status !== "completed") throw new Error("Only a completed return has a debit note to void.");

  const credit = new Big(row.supplierCreditAmount);
  if (credit.gt(0)) {
    const balance = new Big(await supplierCreditBalance(tx, row.supplierId));
    if (balance.lt(credit)) {
      throw new Error(`${formatRupees(credit.minus(balance).toFixed(2))} of this return's credit was already used on later payments, so it can't be voided.`);
    }
    await tx.insert(supplierCreditMovements).values({
      supplierId: row.supplierId,
      kind: "issue_reversed",
      amount: credit.times(-1).toFixed(2),
      supplierReturnId: row.id,
      purchaseId: purchase.id,
      note: `Debit note ${row.debitNoteNumber} voided`,
      performedById: actorId,
    });
  }

  let walletName: string | null = null;
  const refund = new Big(row.refundAmount);
  if (refund.gt(0) && row.refundWalletId) {
    const [wallet] = await tx.select({ id: wallets.id, name: wallets.name }).from(wallets).where(eq(wallets.id, row.refundWalletId)).for("update");
    walletName = wallet?.name ?? null;
    await tx.update(wallets).set({ balance: sql`${wallets.balance} - ${refund.toFixed(2)}` }).where(eq(wallets.id, row.refundWalletId));
    await tx.insert(transactions).values({
      id: createId(),
      walletId: row.refundWalletId,
      type: "debit",
      amount: refund.toFixed(2),
      source: "Supplier Refund",
      referenceId: row.id,
      description: `Reversal: debit note ${row.debitNoteNumber} voided`,
      reversalOfTransactionId: row.refundTransactionId,
      performedById: actorId,
    });
  }

  if (new Big(row.appliedToPurchaseAmount).gt(0)) {
    await tx.update(purchaseRecords)
      .set({ returnedAmount: sql`${purchaseRecords.returnedAmount} - ${row.appliedToPurchaseAmount}`, updatedAt: new Date() })
      .where(eq(purchaseRecords.id, purchase.id));
  }

  await moveReturnStock(tx, row, "back", actorId, `Debit note ${row.debitNoteNumber} voided: ${reason}`);
  await tx.update(supplierReturns)
    .set({ status: "voided", voidedById: actorId, voidedAt: new Date(), voidReason: reason, updatedAt: new Date() })
    .where(eq(supplierReturns.id, row.id));

  return { debitNoteNumber: row.debitNoteNumber!, refundTakenBack: refund.toFixed(2), walletName };
}

const MONEY = /^\d+(\.\d{1,2})?$/;

export async function applySupplierCredit(tx: Tx, input: { purchaseId: string; amount: string }, actorId: string) {
  if (!MONEY.test(input.amount) || new Big(input.amount).lte(0)) throw new Error("Enter an amount above 0 with at most 2 decimals");
  const amount = new Big(input.amount);
  const purchase = await loadPurchase(tx, input.purchaseId, true);
  if (purchase.voidedAt) throw new Error("Purchase is already voided");
  // Serialise credit use per supplier: lock the supplier row.
  await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, purchase.supplierId)).for("update");
  const balance = new Big(await supplierCreditBalance(tx, purchase.supplierId));
  if (amount.gt(balance)) throw new Error(`Supplier credit is only ${formatRupees(balance.toFixed(2))}`);
  const owed = purchaseOwed(purchase);
  if (amount.gt(owed)) throw new Error(`Only ${formatRupees(owed.toFixed(2))} is still owed on this purchase`);

  await tx.update(purchaseRecords)
    .set({ paidAmount: sql`${purchaseRecords.paidAmount} + ${amount.toFixed(2)}`, updatedAt: new Date() })
    .where(eq(purchaseRecords.id, purchase.id));
  const [payment] = await tx.insert(supplierPayments).values({
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    amount: amount.toFixed(2),
    method: SUPPLIER_CREDIT_METHOD,
    walletId: null,
    reference: "Supplier credit",
  }).returning({ id: supplierPayments.id });
  await tx.insert(supplierCreditMovements).values({
    supplierId: purchase.supplierId,
    kind: "used",
    amount: amount.times(-1).toFixed(2),
    purchaseId: purchase.id,
    supplierPaymentId: payment.id,
    performedById: actorId,
  });
  return { paymentId: payment.id, balanceAfter: balance.minus(amount).toFixed(2) };
}

export async function assertPurchaseHasNoActiveReturn(tx: Tx, purchaseId: string) {
  const [active] = await tx.select({ returnNumber: supplierReturns.returnNumber }).from(supplierReturns)
    .where(and(eq(supplierReturns.purchaseId, purchaseId), inArray(supplierReturns.status, [...ACTIVE_SUPPLIER_RETURN_STATUSES])))
    .limit(1);
  if (active) throw new Error(`This purchase has supplier return ${active.returnNumber}. Cancel or void the return first.`);
}

/** Before a purchase is deleted: credit spent on it goes back to the supplier. */
export async function restoreCreditUsedOnPurchase(tx: Tx, purchaseId: string, actorId: string) {
  const payments = await tx.select({ amount: supplierPayments.amount, supplierId: supplierPayments.supplierId }).from(supplierPayments)
    .where(and(eq(supplierPayments.purchaseId, purchaseId), eq(supplierPayments.method, SUPPLIER_CREDIT_METHOD)));
  const total = payments.reduce((sum, p) => sum.plus(p.amount), new Big(0));
  if (total.gt(0)) {
    await tx.insert(supplierCreditMovements).values({
      supplierId: payments[0].supplierId,
      kind: "use_reversed",
      amount: total.toFixed(2),
      purchaseId,
      note: "Purchase deleted; supplier credit given back",
      performedById: actorId,
    });
  }
  return total.toFixed(2);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type { SupplierReturnRow };


const rowSelect = {
  id: supplierReturns.id,
  returnNumber: supplierReturns.returnNumber,
  status: supplierReturns.status,
  requestedAt: supplierReturns.requestedAt,
  dispatchedAt: supplierReturns.dispatchedAt,
  completedAt: supplierReturns.completedAt,
  chemicalName: chemicals.name,
  chemicalUnit: chemicals.unit,
  packagingName: packagingMaterials.name,
  packagingMeasuredInKg: packagingMaterials.measuredInKg,
  warehouseName: warehouses.name,
  quantity: supplierReturns.quantity,
  unitCost: supplierReturns.unitCost,
  totalAmount: supplierReturns.totalAmount,
  reason: supplierReturns.reason,
  notes: supplierReturns.notes,
  debitNoteNumber: supplierReturns.debitNoteNumber,
  appliedToPurchaseAmount: supplierReturns.appliedToPurchaseAmount,
  refundAmount: supplierReturns.refundAmount,
  refundWalletName: wallets.name,
  supplierCreditAmount: supplierReturns.supplierCreditAmount,
  purchaseInvoiceNumber: purchaseRecords.invoiceNumber,
  purchaseDate: purchaseRecords.purchaseDate,
  cancelReason: supplierReturns.cancelReason,
  voidReason: supplierReturns.voidReason,
  requestedByName: user.name,
};

function baseQuery(tx: Tx) {
  return tx
    .select(rowSelect)
    .from(supplierReturns)
    .innerJoin(purchaseRecords, eq(purchaseRecords.id, supplierReturns.purchaseId))
    .innerJoin(warehouses, eq(warehouses.id, supplierReturns.warehouseId))
    .leftJoin(chemicals, eq(chemicals.id, supplierReturns.chemicalId))
    .leftJoin(packagingMaterials, eq(packagingMaterials.id, supplierReturns.packagingMaterialId))
    .leftJoin(wallets, eq(wallets.id, supplierReturns.refundWalletId))
    .leftJoin(user, eq(user.id, supplierReturns.requestedById));
}

type RawReturnRow = Awaited<ReturnType<typeof baseQuery>>[number];

function toRow(r: RawReturnRow): SupplierReturnRow {
  const { chemicalName, chemicalUnit, packagingName, packagingMeasuredInKg, ...rest } = r;
  return {
    ...rest,
    status: r.status as SupplierReturnStatus,
    materialName: chemicalName ?? packagingName ?? "Material",
    unit: chemicalName ? (chemicalUnit ?? "kg") : packagingUnit({ measuredInKg: packagingMeasuredInKg }),
    quantity: new Big(r.quantity).toFixed(3),
    unitCost: new Big(r.unitCost).toFixed(2),
    totalAmount: new Big(r.totalAmount).toFixed(2),
    appliedToPurchaseAmount: new Big(r.appliedToPurchaseAmount).toFixed(2),
    refundAmount: new Big(r.refundAmount).toFixed(2),
    supplierCreditAmount: new Big(r.supplierCreditAmount).toFixed(2),
  };
}

export async function listSupplierReturns(
  tx: Tx,
  input: { supplierId: string; queue: SupplierReturnQueue },
): Promise<{ rows: SupplierReturnRow[]; counts: Record<SupplierReturnQueue, number> }> {
  const rows = await baseQuery(tx)
    .where(and(eq(supplierReturns.supplierId, input.supplierId), inArray(supplierReturns.status, QUEUE_STATUSES[input.queue])))
    .orderBy(desc(supplierReturns.requestedAt), desc(supplierReturns.id))
    .limit(200);
  const countRows = await tx
    .select({ status: supplierReturns.status, n: sql<number>`count(*)::int` })
    .from(supplierReturns)
    .where(eq(supplierReturns.supplierId, input.supplierId))
    .groupBy(supplierReturns.status);
  const counts: Record<SupplierReturnQueue, number> = { to_dispatch: 0, dispatched: 0, done: 0 };
  const queues = Object.keys(QUEUE_STATUSES) as SupplierReturnQueue[];
  for (const c of countRows) {
    const queue = queues.find((q) => QUEUE_STATUSES[q].includes(c.status as SupplierReturnStatus));
    if (queue) counts[queue] += Number(c.n);
  }
  return { rows: rows.map(toRow), counts };
}

export async function getSupplierReturn(tx: Tx, returnId: string) {
  const [row] = await baseQuery(tx).where(eq(supplierReturns.id, returnId));
  if (!row) throw new Error("Supplier return not found");
  const [supplier] = await tx
    .select({ name: suppliers.supplierName, phone: suppliers.phone, address: suppliers.address })
    .from(suppliers)
    .innerJoin(supplierReturns, eq(supplierReturns.supplierId, suppliers.id))
    .where(eq(supplierReturns.id, returnId));
  return {
    ...toRow(row),
    supplierName: supplier?.name ?? "Supplier",
    supplierPhone: supplier?.phone ?? null,
    supplierAddress: supplier?.address ?? null,
  };
}
