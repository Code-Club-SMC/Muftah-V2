import Big from "big.js";
import { format, parseISO } from "date-fns";
import { formatRupees } from "@/lib/finance/expense-entry";

export const SALARY_PAYMENT_KINDS = ["payment", "refund", "recovery"] as const;
export type SalaryPaymentKind = (typeof SALARY_PAYMENT_KINDS)[number];
export const SALARY_PAYMENT_STATUSES = ["active", "reversed"] as const;
export type SalaryPaymentStatus = (typeof SALARY_PAYMENT_STATUSES)[number];

export type SalaryPaymentLike = { kind: SalaryPaymentKind; amount: string; status: SalaryPaymentStatus };
export type SlipPaymentStatus = "unpaid" | "paid" | "balance_due" | "overpaid" | "nothing_to_pay";
export type SlipPaymentState = { status: SlipPaymentStatus; net: string; paid: string; due: string; overpaid: string };
export type RegisterPaymentSummary = { slipCount: number; paidCount: number; paidTotal: string; remainingTotal: string };

export const SLIP_PAYMENT_LABELS: Record<SlipPaymentStatus, string> = {
  unpaid: "Generated",
  paid: "Paid",
  balance_due: "Balance due",
  overpaid: "Overpaid",
  nothing_to_pay: "Nothing to pay",
};

export const PAYROLL_LEDGER_SOURCE_PREFIX = "Payroll";
/** Written by the sales desk when a distributor pays a salesman's salary (stored as a salary advance). */
export const DISTRIBUTOR_SALARY_REASON_PREFIX = "Salary paid directly by distributor";

/** Payments add; refunds (money handed back) and recoveries (taken from a later salary) subtract. Reversed rows never count. */
export function paidAmount(rows: SalaryPaymentLike[]): Big {
  return rows
    .filter((row) => row.status === "active")
    .reduce((sum, row) => (row.kind === "payment" ? sum.plus(row.amount) : sum.minus(row.amount)), new Big(0));
}

export function slipPaymentState(netSalary: string | null | undefined, rows: SalaryPaymentLike[]): SlipPaymentState {
  const net = new Big(netSalary || 0);
  const payable = net.gt(0) ? net : new Big(0);
  const paid = paidAmount(rows);
  const diff = payable.minus(paid);
  let status: SlipPaymentStatus;
  if (payable.eq(0) && paid.eq(0)) status = "nothing_to_pay";
  else if (paid.eq(0)) status = "unpaid";
  else if (diff.eq(0)) status = "paid";
  else if (diff.gt(0)) status = "balance_due";
  else status = "overpaid";
  return {
    status,
    net: net.toFixed(2),
    paid: paid.toFixed(2),
    due: diff.gt(0) ? diff.toFixed(2) : "0.00",
    overpaid: diff.lt(0) ? diff.abs().toFixed(2) : "0.00",
  };
}

export function registerPaymentSummary(states: SlipPaymentState[]): RegisterPaymentSummary {
  return {
    slipCount: states.length,
    paidCount: states.filter((state) => state.status === "paid").length,
    paidTotal: states.reduce((sum, state) => sum.plus(state.paid), new Big(0)).toFixed(2),
    remainingTotal: states.reduce((sum, state) => sum.plus(state.due), new Big(0)).toFixed(2),
  };
}

export function firstDayOfPayrollMonth(payrollMonth: string): string {
  return `${payrollMonth.slice(0, 7)}-01`;
}

export function paymentDateError(dateKey: string, payrollMonth: string, todayKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "Choose a payment date";
  if (dateKey > todayKey) return "Payment date can't be in the future";
  const first = firstDayOfPayrollMonth(payrollMonth);
  if (dateKey < first) return `Payment date can't be before ${format(parseISO(first), "d MMM yyyy")}`;
  return null;
}

/** Noon in Pakistan on the chosen day, so the Ledger shows the same calendar day in any time zone near PKT. */
export function effectiveDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T07:00:00.000Z`);
}

export function payrollMonthLabel(payrollMonth: string): string {
  return format(parseISO(firstDayOfPayrollMonth(payrollMonth)), "MMM yyyy");
}

export function payrollLedgerSource(payrollMonth: string): string {
  return `${PAYROLL_LEDGER_SOURCE_PREFIX} - ${payrollMonthLabel(payrollMonth)}`;
}

export function salaryLedgerDescription(kind: "payment" | "refund", employeeName: string, payrollMonth: string): string {
  const label = kind === "payment" ? "Salary" : "Salary refund";
  return `${label} — ${employeeName} — ${payrollMonthLabel(payrollMonth)}`;
}

export function salaryReversalDescription(employeeName: string, payrollMonth: string, reason: string): string {
  return `Reversal of salary — ${employeeName} — ${payrollMonthLabel(payrollMonth)} — ${reason}`;
}

export function overpaidRecoveryReason(payrollMonth: string): string {
  return `Salary overpaid for ${payrollMonthLabel(payrollMonth)} — taken back from the next salary`;
}

export function shortfallMessage(walletName: string, balance: string, needed: string): string {
  const short = new Big(needed).minus(balance).toFixed(2);
  return `${walletName} has ${formatRupees(balance)}. Needed ${formatRupees(needed)}. Short by ${formatRupees(short)}.`;
}

export function isPayrollLedgerSource(source: string): boolean {
  return source === PAYROLL_LEDGER_SOURCE_PREFIX || source.startsWith(`${PAYROLL_LEDGER_SOURCE_PREFIX} - `);
}
