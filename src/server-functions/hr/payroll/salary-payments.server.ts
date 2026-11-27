import Big from "big.js";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { db } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { advanceInstallments, employees, payrolls, payslips, salaryAdvances, salaryPayments } from "@/db/schemas/hr-schema";
import {
  effectiveDateFromKey,
  overpaidRecoveryReason,
  paymentDateError,
  payrollLedgerSource,
  salaryLedgerDescription,
  salaryReversalDescription,
  shortfallMessage,
  slipPaymentState,
  DISTRIBUTOR_SALARY_REASON_PREFIX,
  registerPaymentSummary,
  type RegisterPaymentSummary,
  type SalaryPaymentKind,
  type SalaryPaymentStatus,
  type SlipPaymentState,
} from "@/lib/hr/salary-payments";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
export type ActiveRow = typeof salaryPayments.$inferSelect;
export type SlipLine = { employeeId: string; payslipId: string; netSalary: string; name: string };

export async function loadPayroll(tx: Executor, payrollId: string) {
  const payroll = await tx.query.payrolls.findFirst({ where: eq(payrolls.id, payrollId) });
  if (!payroll) throw new Error("Payroll not found");
  return payroll;
}

export function assertPaymentDate(dateKey: string, payrollMonth: string, todayKey: string) {
  const error = paymentDateError(dateKey, payrollMonth, todayKey);
  if (error) throw new Error(error);
}

/** Locks the slips (in employee-code order, so concurrent calls can't deadlock) before reading their payments. */
export async function lockSlips(tx: Tx, payrollId: string, employeeIds: string[]): Promise<SlipLine[]> {
  const unique = [...new Set(employeeIds)];
  if (unique.length === 0) throw new Error("Choose at least one salary");
  const rows = await tx
    .select({
      employeeId: payslips.employeeId,
      payslipId: payslips.id,
      netSalary: payslips.netSalary,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(eq(payslips.payrollId, payrollId), inArray(payslips.employeeId, unique)))
    .orderBy(asc(employees.employeeCode))
    .for("update", { of: payslips });
  if (rows.length !== unique.length) throw new Error("A selected payslip no longer exists. Refresh and try again.");
  return rows.map((row) => ({
    employeeId: row.employeeId,
    payslipId: row.payslipId,
    netSalary: row.netSalary,
    name: `${row.firstName} ${row.lastName}`,
  }));
}

export async function activeRows(tx: Executor, payrollId: string, employeeIds: string[]): Promise<Map<string, ActiveRow[]>> {
  const map = new Map<string, ActiveRow[]>();
  if (employeeIds.length === 0) return map;
  const rows = await tx
    .select()
    .from(salaryPayments)
    .where(and(
      eq(salaryPayments.payrollId, payrollId),
      eq(salaryPayments.status, "active"),
      inArray(salaryPayments.employeeId, employeeIds),
    ))
    .orderBy(asc(salaryPayments.createdAt));
  for (const row of rows) map.set(row.employeeId, [...(map.get(row.employeeId) ?? []), row]);
  return map;
}

/** Locks the account and checks it can cover the whole amount before any money moves. */
export async function assertWalletCovers(tx: Tx, walletId: string, needed: string) {
  const [wallet] = await tx
    .select({ name: wallets.name, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .for("update");
  if (!wallet) throw new Error("Account not found");
  if (new Big(wallet.balance).lt(needed)) throw new Error(shortfallMessage(wallet.name, wallet.balance, needed));
  return wallet;
}

/** Moves money on one account and writes its Ledger line. A debit never takes the account below zero. */
export async function moveMoney(
  tx: Tx,
  input: {
    walletId: string;
    type: "debit" | "credit";
    amount: string;
    source: string;
    description: string;
    effectiveDate: Date;
    actorId: string;
    referenceId: string;
    reversalOfTransactionId?: string | null;
  },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance: input.type === "debit"
        ? sql`${wallets.balance} - ${input.amount}`
        : sql`${wallets.balance} + ${input.amount}`,
    })
    .where(input.type === "debit"
      ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
      : eq(wallets.id, input.walletId))
    .returning({ id: wallets.id });
  if (!wallet) {
    const [existing] = await tx.select({ name: wallets.name, balance: wallets.balance }).from(wallets).where(eq(wallets.id, input.walletId));
    if (!existing) throw new Error("Account not found");
    throw new Error(shortfallMessage(existing.name, existing.balance, input.amount));
  }
  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    source: input.source,
    referenceId: input.referenceId,
    description: input.description,
    effectiveDate: input.effectiveDate,
    reversalOfTransactionId: input.reversalOfTransactionId ?? null,
    performedById: input.actorId,
  });
  return id;
}

export async function insertPayment(
  tx: Tx,
  input: { payrollId: string; payrollMonth: string; employeeId: string; name: string; walletId: string; amount: string; paymentDate: string; actorId: string },
) {
  const id = createId();
  const transactionId = await moveMoney(tx, {
    walletId: input.walletId,
    type: "debit",
    amount: input.amount,
    source: payrollLedgerSource(input.payrollMonth),
    description: salaryLedgerDescription("payment", input.name, input.payrollMonth),
    effectiveDate: effectiveDateFromKey(input.paymentDate),
    actorId: input.actorId,
    referenceId: id,
  });
  await tx.insert(salaryPayments).values({
    id,
    payrollId: input.payrollId,
    employeeId: input.employeeId,
    kind: "payment",
    amount: input.amount,
    walletId: input.walletId,
    transactionId,
    paymentDate: input.paymentDate,
    recordedById: input.actorId,
  });
  return id;
}

export type PaySalariesInput = {
  payrollId: string;
  employeeIds: string[];
  walletId: string;
  paymentDate: string;
  todayKey: string;
  actorId: string;
};

/** Pays what is still due on each chosen slip (full net, or the balance after a revision). All or nothing. */
export async function paySalaries(tx: Tx, input: PaySalariesInput) {
  const payroll = await loadPayroll(tx, input.payrollId);
  assertPaymentDate(input.paymentDate, payroll.month, input.todayKey);
  const slips = await lockSlips(tx, payroll.id, input.employeeIds);
  const existing = await activeRows(tx, payroll.id, slips.map((slip) => slip.employeeId));
  const lines = slips.map((slip) => ({
    ...slip,
    due: slipPaymentState(slip.netSalary, existing.get(slip.employeeId) ?? []).due,
  }));
  const settled = lines.find((line) => !new Big(line.due).gt(0));
  if (settled) throw new Error(`${settled.name} has nothing left to pay. Refresh and try again.`);
  const total = lines.reduce((sum, line) => sum.plus(line.due), new Big(0)).toFixed(2);
  await assertWalletCovers(tx, input.walletId, total);
  for (const line of lines) {
    await insertPayment(tx, {
      payrollId: payroll.id,
      payrollMonth: payroll.month,
      employeeId: line.employeeId,
      name: line.name,
      walletId: input.walletId,
      amount: line.due,
      paymentDate: input.paymentDate,
      actorId: input.actorId,
    });
  }
  return { paidCount: lines.length, total };
}

type ReverseContext = { reason: string; actorId: string; todayKey: string; name: string; payrollMonth: string };

/**
 * Reverses one active row. Payment: money back into its account. Refund: money out again.
 * Recovery: cancels its advance, only while no later slip has deducted it. Dated today.
 */
export async function reverseRow(tx: Tx, row: ActiveRow, ctx: ReverseContext) {
  let reversalTransactionId: string | null = null;
  if (row.kind === "recovery") {
    const [cancelled] = await tx
      .update(salaryAdvances)
      .set({ status: "cancelled" })
      .where(and(eq(salaryAdvances.id, row.advanceId!), eq(salaryAdvances.status, "approved"), eq(salaryAdvances.installmentsPaid, 0)))
      .returning({ id: salaryAdvances.id });
    if (!cancelled) throw new Error(`The overpaid amount for ${ctx.name} was already taken from a later salary, so it can't be undone.`);
  } else {
    reversalTransactionId = await moveMoney(tx, {
      walletId: row.walletId!,
      type: row.kind === "payment" ? "credit" : "debit",
      amount: row.amount,
      source: payrollLedgerSource(ctx.payrollMonth),
      description: salaryReversalDescription(ctx.name, ctx.payrollMonth, ctx.reason),
      effectiveDate: effectiveDateFromKey(ctx.todayKey),
      actorId: ctx.actorId,
      referenceId: row.id,
      reversalOfTransactionId: row.transactionId,
    });
  }
  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "reversed", reversedAt: new Date(), reversedById: ctx.actorId, reversalReason: ctx.reason, reversalTransactionId })
    .where(and(eq(salaryPayments.id, row.id), eq(salaryPayments.status, "active")))
    .returning({ id: salaryPayments.id });
  if (!updated) throw new Error("This payment changed. Refresh and try again.");
}

export async function changeSalaryAccount(tx: Tx, input: PaySalariesInput) {
  const payroll = await loadPayroll(tx, input.payrollId);
  assertPaymentDate(input.paymentDate, payroll.month, input.todayKey);
  const slips = await lockSlips(tx, payroll.id, input.employeeIds);
  const existing = await activeRows(tx, payroll.id, slips.map((slip) => slip.employeeId));
  const [target] = await tx.select({ name: wallets.name }).from(wallets).where(eq(wallets.id, input.walletId));
  if (!target) throw new Error("Account not found");

  const moves = slips.map((slip) => {
    const payments = (existing.get(slip.employeeId) ?? []).filter((row) => row.kind === "payment");
    if (payments.length === 0) throw new Error(`${slip.name} is not paid yet.`);
    const toMove = payments.filter((row) => row.walletId !== input.walletId);
    if (toMove.length === 0) throw new Error(`${slip.name} is already paid from ${target.name}.`);
    return { slip, toMove };
  });

  const reason = `Account changed to ${target.name}`;
  for (const { slip, toMove } of moves) {
    for (const row of toMove) {
      await reverseRow(tx, row, { reason, actorId: input.actorId, todayKey: input.todayKey, name: slip.name, payrollMonth: payroll.month });
    }
  }
  const total = moves.flatMap((move) => move.toMove).reduce((sum, row) => sum.plus(row.amount), new Big(0)).toFixed(2);
  await assertWalletCovers(tx, input.walletId, total);
  for (const { slip, toMove } of moves) {
    for (const row of toMove) {
      await insertPayment(tx, {
        payrollId: payroll.id,
        payrollMonth: payroll.month,
        employeeId: slip.employeeId,
        name: slip.name,
        walletId: input.walletId,
        amount: row.amount,
        paymentDate: input.paymentDate,
        actorId: input.actorId,
      });
    }
  }
  return { movedCount: moves.length, total };
}

const UNDO_ORDER = { recovery: 0, refund: 1, payment: 2 } as const;

export async function undoSalaryPayment(
  tx: Tx,
  input: { payrollId: string; employeeId: string; reason: string; todayKey: string; actorId: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Give a reason of at least 3 characters");
  const payroll = await loadPayroll(tx, input.payrollId);
  const [slip] = await lockSlips(tx, payroll.id, [input.employeeId]);
  const rows = (await activeRows(tx, payroll.id, [slip.employeeId])).get(slip.employeeId) ?? [];
  if (rows.length === 0) throw new Error(`${slip.name} has no payment to undo.`);
  for (const row of [...rows].sort((a, b) => UNDO_ORDER[a.kind] - UNDO_ORDER[b.kind])) {
    await reverseRow(tx, row, { reason, actorId: input.actorId, todayKey: input.todayKey, name: slip.name, payrollMonth: payroll.month });
  }
  return { reversedCount: rows.length };
}

async function lockOverpaidSlip(tx: Tx, payrollId: string, employeeId: string) {
  const payroll = await loadPayroll(tx, payrollId);
  const [slip] = await lockSlips(tx, payroll.id, [employeeId]);
  const rows = (await activeRows(tx, payroll.id, [slip.employeeId])).get(slip.employeeId) ?? [];
  const state = slipPaymentState(slip.netSalary, rows);
  if (!new Big(state.overpaid).gt(0)) throw new Error(`${slip.name} isn't overpaid.`);
  return { payroll, slip, overpaid: state.overpaid };
}

export async function recordSalaryRefund(
  tx: Tx,
  input: { payrollId: string; employeeId: string; walletId: string; paymentDate: string; todayKey: string; actorId: string },
) {
  const { payroll, slip, overpaid } = await lockOverpaidSlip(tx, input.payrollId, input.employeeId);
  assertPaymentDate(input.paymentDate, payroll.month, input.todayKey);
  const id = createId();
  const transactionId = await moveMoney(tx, {
    walletId: input.walletId,
    type: "credit",
    amount: overpaid,
    source: payrollLedgerSource(payroll.month),
    description: salaryLedgerDescription("refund", slip.name, payroll.month),
    effectiveDate: effectiveDateFromKey(input.paymentDate),
    actorId: input.actorId,
    referenceId: id,
  });
  await tx.insert(salaryPayments).values({
    id, payrollId: payroll.id, employeeId: slip.employeeId, kind: "refund", amount: overpaid,
    walletId: input.walletId, transactionId, paymentDate: input.paymentDate, recordedById: input.actorId,
  });
  return { amount: overpaid };
}

/** Creates a one-installment advance that the next generated payslip deducts. No money moves now. */
export async function recoverOverpaidSalary(
  tx: Tx,
  input: { payrollId: string; employeeId: string; todayKey: string; actorId: string },
) {
  const { payroll, slip, overpaid } = await lockOverpaidSlip(tx, input.payrollId, input.employeeId);
  const [advance] = await tx
    .insert(salaryAdvances)
    .values({
      employeeId: slip.employeeId,
      amount: overpaid,
      date: input.todayKey,
      reason: overpaidRecoveryReason(payroll.month),
      status: "approved",
      approvedBy: input.actorId,
      installmentMonths: 1,
      installmentAmount: overpaid,
    })
    .returning({ id: salaryAdvances.id });
  await tx.insert(salaryPayments).values({
    payrollId: payroll.id, employeeId: slip.employeeId, kind: "recovery", amount: overpaid,
    advanceId: advance.id, paymentDate: input.todayKey, recordedById: input.actorId,
  });
  return { amount: overpaid };
}

export const slipKey = (payrollId: string, employeeId: string) => `${payrollId}:${employeeId}`;
export type SlipPaymentRow = ActiveRow & { walletName: string | null };
export type RegisterSlipPayment = SlipPaymentState & { paidFrom: string | null };
export type PayableSlip = { employeeId: string; name: string; due: string };

export async function loadActivePaymentsForPayrolls(executor: Executor, payrollIds: string[]) {
  const map = new Map<string, SlipPaymentRow[]>();
  if (payrollIds.length === 0) return map;
  const rows = await executor
    .select({ payment: salaryPayments, walletName: wallets.name })
    .from(salaryPayments)
    .leftJoin(wallets, eq(wallets.id, salaryPayments.walletId))
    .where(and(inArray(salaryPayments.payrollId, payrollIds), eq(salaryPayments.status, "active")))
    .orderBy(asc(salaryPayments.createdAt));
  for (const { payment, walletName } of rows) {
    const key = slipKey(payment.payrollId, payment.employeeId);
    map.set(key, [...(map.get(key) ?? []), { ...payment, walletName }]);
  }
  return map;
}

/** Account names of the active payments, e.g. "Cash in Hand" or "Cash in Hand, Bank Alfalah". */
export function paidFromText(rows: SlipPaymentRow[]): string | null {
  const names = [...new Set(rows.filter((row) => row.kind === "payment" && row.walletName).map((row) => row.walletName!))];
  return names.length ? names.join(", ") : null;
}

export async function loadRegisterPayments(executor: Executor, payrollId: string) {
  const slips = await executor
    .select({ employeeId: payslips.employeeId, netSalary: payslips.netSalary, firstName: employees.firstName, lastName: employees.lastName })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.payrollId, payrollId))
    .orderBy(asc(employees.employeeCode));
  const payments = await loadActivePaymentsForPayrolls(executor, [payrollId]);
  const byEmployee = new Map<string, RegisterSlipPayment>();
  const payable: PayableSlip[] = [];
  for (const slip of slips) {
    const rows = payments.get(slipKey(payrollId, slip.employeeId)) ?? [];
    const state = slipPaymentState(slip.netSalary, rows);
    byEmployee.set(slip.employeeId, { ...state, paidFrom: paidFromText(rows) });
    if (new Big(state.due).gt(0)) payable.push({ employeeId: slip.employeeId, name: `${slip.firstName} ${slip.lastName}`, due: state.due });
  }
  const summary: RegisterPaymentSummary = registerPaymentSummary([...byEmployee.values()]);
  return { byEmployee, summary, payable };
}

export async function getSlipPaymentHistory(executor: Executor, payslipId: string) {
  const slip = await executor.query.payslips.findFirst({
    where: eq(payslips.id, payslipId),
    columns: { id: true, payrollId: true, employeeId: true, netSalary: true },
  });
  if (!slip) throw new Error("Payslip not found");
  const rows = await executor.query.salaryPayments.findMany({
    where: and(eq(salaryPayments.payrollId, slip.payrollId), eq(salaryPayments.employeeId, slip.employeeId)),
    with: {
      wallet: { columns: { name: true } },
      recordedBy: { columns: { name: true } },
      reversedBy: { columns: { name: true } },
    },
    orderBy: [asc(salaryPayments.createdAt)],
  });
  const active = rows.filter((row) => row.status === "active").map((row) => ({ ...row, walletName: row.wallet?.name ?? null }));
  const [distributor] = await executor
    .select({ total: sql<string>`coalesce(sum(${advanceInstallments.amount}), 0)` })
    .from(advanceInstallments)
    .innerJoin(salaryAdvances, eq(salaryAdvances.id, advanceInstallments.advanceId))
    .where(and(
      eq(advanceInstallments.payslipId, slip.id),
      sql`${salaryAdvances.reason} like ${`${DISTRIBUTOR_SALARY_REASON_PREFIX}%`}`,
    ));
  return {
    state: slipPaymentState(slip.netSalary, active),
    paidFrom: paidFromText(active),
    distributorPaid: new Big(distributor?.total ?? 0).toFixed(2),
    payments: rows.map((row) => ({
      id: row.id,
      kind: row.kind as SalaryPaymentKind,
      amount: row.amount,
      walletName: row.wallet?.name ?? null,
      paymentDate: row.paymentDate,
      enteredAt: row.createdAt,
      recordedBy: row.recordedBy?.name ?? null,
      status: row.status as SalaryPaymentStatus,
      reversalReason: row.reversalReason,
      reversedAt: row.reversedAt,
      reversedBy: row.reversedBy?.name ?? null,
    })),
  };
}
export type SlipPaymentHistory = Awaited<ReturnType<typeof getSlipPaymentHistory>>;
