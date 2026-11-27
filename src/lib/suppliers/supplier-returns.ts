import Big from "big.js";
import { formatRupees } from "@/lib/finance/expense-entry";

export const SUPPLIER_RETURN_STATUSES = ["requested", "dispatched", "completed", "cancelled", "voided"] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

/** Returns that still hold the purchase: it can't be edited or deleted while one exists. */
export const ACTIVE_SUPPLIER_RETURN_STATUSES = ["requested", "dispatched", "completed"] as const satisfies readonly SupplierReturnStatus[];

export const SUPPLIER_RETURN_STATUS_LABELS: Record<SupplierReturnStatus, string> = {
  requested: "Requested",
  dispatched: "Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
  voided: "Voided",
};

export type SupplierReturnQueue = "to_dispatch" | "dispatched" | "done";
export const QUEUE_STATUSES: Record<SupplierReturnQueue, SupplierReturnStatus[]> = {
  to_dispatch: ["requested"],
  dispatched: ["dispatched"],
  done: ["completed", "cancelled", "voided"],
};

/** Supplier payment method for a payment made from supplier credit. It has no wallet. */
export const SUPPLIER_CREDIT_METHOD = "supplier_credit";

function padded(prefix: string, sequence: number) {
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error(`${prefix} sequence must be a positive integer`);
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}
export const formatSupplierReturnNumber = (n: number) => padded("SR", n);
export const formatDebitNoteNumber = (n: number) => padded("DN", n);

/** What we still owe on a purchase. Never below zero. */
export function purchaseOwed(p: { cost: string; paidAmount: string | null; returnedAmount?: string | null }): Big {
  const owed = new Big(p.cost || "0").minus(p.paidAmount || "0").minus(p.returnedAmount || "0");
  return owed.lt(0) ? new Big(0) : owed;
}

export function supplierReturnValue(quantity: string, unitCost: string): string {
  return new Big(quantity).times(unitCost).round(2, Big.roundHalfUp).toFixed(2);
}

export function maxReturnable(input: { stockLeft: string; storeStock: string; pendingRequested: string }): string {
  const left = new Big(input.stockLeft);
  const store = new Big(input.storeStock);
  const max = (left.lt(store) ? left : store).minus(input.pendingRequested);
  return (max.lt(0) ? new Big(0) : max).toFixed(3);
}

export function splitDebitNote(input: { value: string; owed: Big | string }): { applied: string; leftover: string } {
  const value = new Big(input.value);
  const owed = new Big(input.owed);
  const applied = value.lt(owed) ? value : owed;
  return { applied: applied.toFixed(2), leftover: value.minus(applied).toFixed(2) };
}

const MONEY = /^\d+(\.\d{1,2})?$/;

export function planLeftover(input: { leftover: string; cashBack?: string | null }): { refund: string; credit: string } {
  const leftover = new Big(input.leftover);
  const raw = input.cashBack?.trim() || "0";
  if (!MONEY.test(raw)) throw new Error("Cash back must be a number with at most 2 decimals");
  const refund = new Big(raw);
  if (refund.gt(leftover)) throw new Error(`Cash back can't be more than ${formatRupees(leftover.toFixed(2))}`);
  return { refund: refund.toFixed(2), credit: leftover.minus(refund).toFixed(2) };
}
