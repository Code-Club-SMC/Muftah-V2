import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireHrManageMiddleware, requireHrViewMiddleware } from "@/lib/middlewares";
import { requirePermission } from "@/lib/authz.server";
import { reportDateKey } from "@/lib/report-dates";
import { logActivityQuiet, type LogActivityParams } from "@/lib/activity-logger.server";
import { payrollMonthLabel } from "@/lib/hr/salary-payments";
import { changeSalaryAccount, getSlipPaymentHistory, paySalaries, recordSalaryRefund, recoverOverpaidSalary, undoSalaryPayment } from "./salary-payments.server";

type Actor = { session: { user: { id: string; name: string } } };
type SalaryEvent = Omit<LogActivityParams, "module" | "actorId" | "actorName">;

const pkr = (amount: string) => `PKR ${Number(amount).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const listNames = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

/** Every salary money movement is logged twice: once for HR (whose salary) and once for Finance (which account). */
async function logSalaryEvent(context: Actor, hr: SalaryEvent, finance: SalaryEvent) {
  const actor = { actorId: context.session.user.id, actorName: context.session.user.name };
  await Promise.all([
    logActivityQuiet({ module: "hr", ...actor, ...hr }),
    logActivityQuiet({ module: "finance", ...actor, ...finance }),
  ]);
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a payment date");

export const paySalariesFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1, "Choose at least one salary"),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    const result = await db.transaction((tx) =>
      paySalaries(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
    const month = payrollMonthLabel(result.payrollMonth);
    const names = listNames(result.lines.map((line) => line.name));
    const metadata = { payrollId: data.payrollId, walletId: data.walletId, account: result.walletName, total: result.total, paymentDate: data.paymentDate, payments: result.lines };
    await logSalaryEvent(
      context,
      { action: "paid", entityType: "salary_payment", entityId: data.payrollId, entityLabel: `Payroll ${month}`, description: `Paid ${month} salary to ${result.paidCount} employee(s) (${names}) — ${pkr(result.total)} from ${result.walletName}`, metadata },
      { action: "debited", entityType: "salary_payment", entityId: data.walletId, entityLabel: result.walletName, description: `${result.walletName} debited ${pkr(result.total)} for ${month} salaries (${names})`, metadata },
    );
    return result;
  });

export const changeSalaryAccountFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1, "Choose at least one salary"),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    const result = await db.transaction((tx) =>
      changeSalaryAccount(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
    const month = payrollMonthLabel(result.payrollMonth);
    const names = listNames(result.names);
    const from = result.fromWalletNames.join(", ");
    const metadata = { payrollId: data.payrollId, walletId: data.walletId, account: result.walletName, previousAccounts: result.fromWalletNames, total: result.total, paymentDate: data.paymentDate, employees: result.names };
    await logSalaryEvent(
      context,
      { action: "updated", entityType: "salary_payment", entityId: data.payrollId, entityLabel: `Payroll ${month}`, description: `Changed ${month} salary account for ${names} from ${from} to ${result.walletName} (${pkr(result.total)})`, metadata, severity: "warning" },
      { action: "transferred", entityType: "salary_payment", entityId: data.walletId, entityLabel: result.walletName, description: `${from} credited back ${pkr(result.total)} and ${result.walletName} debited ${pkr(result.total)} for ${month} salaries (${names})`, metadata, severity: "warning" },
    );
    return result;
  });

export const undoSalaryPaymentFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeId: z.string().min(1),
    reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(500),
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    const result = await db.transaction((tx) =>
      undoSalaryPayment(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
    const month = payrollMonthLabel(result.payrollMonth);
    const accounts = result.walletNames.join(", ") || "no account";
    const metadata = { payrollId: data.payrollId, employeeId: data.employeeId, reason: result.reason, returnedTotal: result.returnedTotal, accounts: result.walletNames, reversedCount: result.reversedCount };
    await logSalaryEvent(
      context,
      { action: "reversed", entityType: "salary_payment", entityId: data.payrollId, entityLabel: result.name, description: `Undid ${month} salary payment for ${result.name}. Reason: ${result.reason}`, metadata, severity: "warning" },
      { action: "credited", entityType: "salary_payment", entityId: data.payrollId, entityLabel: accounts, description: `${accounts} credited back ${pkr(result.returnedTotal)} — undone ${month} salary of ${result.name}`, metadata, severity: "warning" },
    );
    return result;
  });

export const recordSalaryRefundFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeId: z.string().min(1),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    const result = await db.transaction((tx) =>
      recordSalaryRefund(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
    const month = payrollMonthLabel(result.payrollMonth);
    const metadata = { payrollId: data.payrollId, employeeId: data.employeeId, walletId: data.walletId, account: result.walletName, amount: result.amount, paymentDate: data.paymentDate };
    await logSalaryEvent(
      context,
      { action: "refunded", entityType: "salary_payment", entityId: data.payrollId, entityLabel: result.name, description: `${result.name} returned overpaid ${month} salary of ${pkr(result.amount)} into ${result.walletName}`, metadata },
      { action: "credited", entityType: "salary_payment", entityId: data.walletId, entityLabel: result.walletName, description: `${result.walletName} credited ${pkr(result.amount)} — overpaid ${month} salary returned by ${result.name}`, metadata },
    );
    return result;
  });

export const recoverOverpaidSalaryFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string().min(1), employeeId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    const result = await db.transaction((tx) =>
      recoverOverpaidSalary(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
    const month = payrollMonthLabel(result.payrollMonth);
    await logActivityQuiet({
      module: "hr",
      action: "created",
      entityType: "salary_payment",
      entityId: data.payrollId,
      entityLabel: result.name,
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Overpaid ${month} salary of ${pkr(result.amount)} for ${result.name} will be taken from next salary (no account touched)`,
      metadata: { payrollId: data.payrollId, employeeId: data.employeeId, amount: result.amount },
    });
    return result;
  });

export const getSalaryPaymentHistoryFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payslipId: z.string().min(1) }))
  .handler(async ({ data }) => getSlipPaymentHistory(db, data.payslipId));
