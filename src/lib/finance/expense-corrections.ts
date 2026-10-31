import Big from "big.js";
import { format } from "date-fns";
import type { ExpenseEditChange } from "@/lib/types/finance-types";
import { formatRupees } from "./expense-entry";

/** Marker in the server error that asks the form to show the "Save anyway?" dialog. */
export const OVERDRAW_CONFIRM_REQUIRED = "OVERDRAW_CONFIRM_REQUIRED";

export function overdrawError(walletName: string, balanceAfter: string): Error {
  return new Error(`${OVERDRAW_CONFIRM_REQUIRED}: "${walletName}" would go to ${formatRupees(balanceAfter)}`);
}

export function isOverdrawConfirmError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(OVERDRAW_CONFIRM_REQUIRED);
}

export type WalletChange = {
  walletId: string;
  type: "debit" | "credit";
  amount: string;
};

/** The account movements needed to turn the old expense into the new one. */
export function planExpenseWalletChanges(
  before: { walletId: string; amount: string | number },
  after: { walletId: string; amount: string | number },
): WalletChange[] {
  const oldAmount = new Big(before.amount);
  const newAmount = new Big(after.amount);

  if (before.walletId !== after.walletId) {
    return [
      { walletId: before.walletId, type: "credit", amount: oldAmount.toFixed(2) },
      { walletId: after.walletId, type: "debit", amount: newAmount.toFixed(2) },
    ];
  }

  const difference = newAmount.minus(oldAmount);
  if (difference.eq(0)) return [];
  return [
    {
      walletId: after.walletId,
      type: difference.gt(0) ? "debit" : "credit",
      amount: difference.abs().toFixed(2),
    },
  ];
}

export function describeExpenseCorrection(kind: "correction" | "void", expenseDate: Date | string): string {
  const day = format(new Date(expenseDate), "d MMM yyyy");
  return kind === "void" ? `Void of expense of ${day}` : `Correction to expense of ${day}`;
}

export function describeWalletChange(change: WalletChange, walletName: string): string {
  return change.type === "debit"
    ? `${formatRupees(change.amount)} more will be taken from ${walletName}`
    : `${formatRupees(change.amount)} goes back to ${walletName}`;
}

export type ExpenseSnapshot = Record<string, string>;

export type ExpenseSnapshotSource = {
  amount: string;
  description: string;
  payee: string | null;
  slipNumber: string | null;
  expenseDate: Date | string;
  categoryName: string;
  walletName: string;
  fields: Array<{ label: string; displayValue: string }>;
};

export function toExpenseSnapshot(source: ExpenseSnapshotSource): ExpenseSnapshot {
  const snapshot: ExpenseSnapshot = {
    Amount: formatRupees(source.amount),
    Category: source.categoryName,
    "Paid to": source.payee ?? "",
    "Paid from": source.walletName,
    Date: format(new Date(source.expenseDate), "d MMM yyyy"),
    Note: source.description,
    "Slip / ref": source.slipNumber ?? "",
  };
  for (const field of source.fields) snapshot[field.label] = field.displayValue;
  return snapshot;
}

export function diffExpenseSnapshots(before: ExpenseSnapshot, after: ExpenseSnapshot): ExpenseEditChange[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => (before[field] ?? "") !== (after[field] ?? ""))
    .map((field) => ({ field, from: before[field] ?? "", to: after[field] ?? "" }));
}

export const EXPENSE_AUTO_LOCK_MESSAGE =
  "This expense was made automatically by another screen (for example a supplier payment or payroll). Change it there.";
export const EXPENSE_VOIDED_MESSAGE = "This expense has been voided and can no longer be changed.";

/** Why an expense cannot be edited or voided, or null when it can. */
export function getExpenseLockReason(expense: { origin: string; voidedAt: Date | string | null }): string | null {
  if (expense.voidedAt) return EXPENSE_VOIDED_MESSAGE;
  if (expense.origin !== "manual") return EXPENSE_AUTO_LOCK_MESSAGE;
  return null;
}
