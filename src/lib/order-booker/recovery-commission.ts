import { roundMoney } from "@/lib/sales/settlement/money";

export type CommissionMode = "recovery" | "suppressed" | "delivery_paid";
export type CommissionEntryKind = "payment" | "payment_reversal" | "return_clawback" | "return_clawback_undo";
export type CommissionBearer = "booker" | "company";

const EARNING_METHODS = new Set(["cash", "bank_transfer", "cheque", "expense_offset"]);

/** Store credit is not new money, so it never earns. */
export function paymentEarnsCommission(method: string): boolean {
  return EARNING_METHODS.has(method);
}

export function commissionAmount(base: number, rate: number): number {
  return roundMoney((base * rate) / 100);
}

/** Commission is earned only up to what the customer really owes (invoice total minus returns). */
export function earnableBase(input: { paymentAmount: number; owed: number; commissionedBase: number }): number {
  const room = roundMoney(Math.max(0, input.owed - input.commissionedBase));
  return roundMoney(Math.max(0, Math.min(input.paymentAmount, room)));
}

/** After a return, money already commissioned above what is now owed is taken back. */
export function clawbackBase(input: { owed: number; commissionedBase: number }): number {
  return roundMoney(Math.max(0, input.commissionedBase - input.owed));
}

export type PayslipCommissionSettlement = {
  earned: number;
  deductions: number;
  net: number;
  payable: number;
  carriedForward: number;
  paysEntries: boolean;
};

/** A negative month pays 0 and its rows wait for the next payslip. */
export function settlePayslipCommission(entries: Array<{ amount: number }>): PayslipCommissionSettlement {
  const earned = roundMoney(entries.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0));
  const deductions = roundMoney(-entries.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0));
  const net = roundMoney(earned - deductions);
  return {
    earned,
    deductions,
    net,
    payable: net > 0 ? net : 0,
    carriedForward: net < 0 ? roundMoney(-net) : 0,
    paysEntries: net > 0,
  };
}

export type LegacyCommissionLine = { orderId: string; orderRef: string; orderDate: string; orderValue: number; rate: number; amount: number };
export type RecoveryCommissionBreakdown = {
  kind: "recovery";
  paymentsCount: number;
  earned: number;
  deductions: number;
  carriedForward: number;
  lines: Array<{ entryDate: string; invoiceNumber: string; kind: CommissionEntryKind; base: number; rate: number; amount: number }>;
};
export type PayslipCommissionBreakdown = LegacyCommissionLine[] | RecoveryCommissionBreakdown;

export function isRecoveryBreakdown(value: unknown): value is RecoveryCommissionBreakdown {
  return Boolean(value) && !Array.isArray(value) && (value as { kind?: string }).kind === "recovery";
}

export type BookerMonthInput = {
  monthStart: Date;
  monthEnd: Date;
  invoices: Array<{ id: string; date: Date; totalPrice: number; mode: CommissionMode | null; rate: number | null }>;
  returns: Array<{ invoiceId: string; totalAmount: number; completedAt: Date; voidedAt: Date | null }>;
  payments: Array<{ invoiceId: string; amount: number; method: string; status: string; effectiveDate: Date | null; reversedAt: Date | null }>;
  entries: Array<{ amount: number; entryDate: Date }>;
};
export type BookerMonthSummary = { delivered: number; returned: number; collected: number; earned: number; stillOwed: number; waiting: number };

const within = (date: Date | null, from: Date, to: Date) => Boolean(date) && date!.getTime() >= from.getTime() && date!.getTime() <= to.getTime();
const byEnd = (date: Date | null, end: Date) => Boolean(date) && date!.getTime() <= end.getTime();

export function summarizeBookerMonth(input: BookerMonthInput): BookerMonthSummary {
  const { monthStart, monthEnd } = input;
  const delivered = input.invoices.filter((i) => within(i.date, monthStart, monthEnd)).reduce((s, i) => s + i.totalPrice, 0);
  const returned = input.returns
    .filter((r) => within(r.completedAt, monthStart, monthEnd) && !byEnd(r.voidedAt, monthEnd))
    .reduce((s, r) => s + r.totalAmount, 0);
  const counted = (p: BookerMonthInput["payments"][number]) => p.status === "confirmed" || p.status === "reversed";
  const collected = input.payments
    .filter((p) => counted(p) && paymentEarnsCommission(p.method) && within(p.effectiveDate, monthStart, monthEnd))
    .reduce((s, p) => s + p.amount, 0);
  const earned = input.entries.filter((e) => within(e.entryDate, monthStart, monthEnd)).reduce((s, e) => s + e.amount, 0);

  let stillOwed = 0;
  let waiting = 0;
  for (const invoice of input.invoices.filter((i) => byEnd(i.date, monthEnd))) {
    const returnedByEnd = input.returns
      .filter((r) => r.invoiceId === invoice.id && byEnd(r.completedAt, monthEnd) && !byEnd(r.voidedAt, monthEnd))
      .reduce((s, r) => s + r.totalAmount, 0);
    const paidByEnd = input.payments
      .filter((p) => p.invoiceId === invoice.id && counted(p) && byEnd(p.effectiveDate, monthEnd) && !byEnd(p.reversedAt, monthEnd))
      .reduce((s, p) => s + p.amount, 0);
    const owed = roundMoney(Math.max(0, invoice.totalPrice - returnedByEnd - paidByEnd));
    stillOwed += owed;
    if (invoice.mode === "recovery" && invoice.rate) waiting += commissionAmount(owed, invoice.rate);
  }
  return {
    delivered: roundMoney(delivered),
    returned: roundMoney(returned),
    collected: roundMoney(collected),
    earned: roundMoney(earned),
    stillOwed: roundMoney(stillOwed),
    waiting: roundMoney(waiting),
  };
}
