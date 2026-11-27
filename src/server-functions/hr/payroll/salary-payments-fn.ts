import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireHrManageMiddleware, requireHrViewMiddleware } from "@/lib/middlewares";
import { requirePermission } from "@/lib/authz.server";
import { reportDateKey } from "@/lib/report-dates";
import { changeSalaryAccount, getSlipPaymentHistory, paySalaries, recordSalaryRefund, recoverOverpaidSalary, undoSalaryPayment } from "./salary-payments.server";

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
    return db.transaction((tx) =>
      paySalaries(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
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
    return db.transaction((tx) =>
      changeSalaryAccount(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
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
    return db.transaction((tx) =>
      undoSalaryPayment(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
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
    return db.transaction((tx) =>
      recordSalaryRefund(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });

export const recoverOverpaidSalaryFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string().min(1), employeeId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      recoverOverpaidSalary(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });

export const getSalaryPaymentHistoryFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payslipId: z.string().min(1) }))
  .handler(async ({ data }) => getSlipPaymentHistory(db, data.payslipId));
