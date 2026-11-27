import Big from "big.js";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { db } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { employees, payrolls, payslips, salaryPayments } from "@/db/schemas/hr-schema";
import {
  effectiveDateFromKey,
  paymentDateError,
  payrollLedgerSource,
  salaryLedgerDescription,
  shortfallMessage,
  slipPaymentState,
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
