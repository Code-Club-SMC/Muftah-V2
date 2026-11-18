import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireFinancePaymentReversalOrManageMiddleware,
  requireFinanceRefundsIssueMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";
import {
  getCustomerCreditSummary,
  issueCustomerRefund,
  reverseCustomerRefund,
} from "./customer-credit-service";

export const getCustomerCreditSummaryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
    z.object({ customerId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    return getCustomerCreditSummary(db, data.customerId);
  });

export const issueCustomerRefundFn = createServerFn()
  .middleware([requireFinanceRefundsIssueMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        customerId: z.string().min(1),
        amount: z.number().positive("Refund amount must be positive"),
        walletId: z.string().min(1, "Pick an account"),
        refundDate: z.coerce.date().default(() => new Date()),
        notes: z.string().trim().max(500).optional(),
        salesReturnId: z.string().min(1).optional(),
        allowOverdraw: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;
    const permissions = Array.from(context.authContext.permissions);

    return db.transaction(async (tx) =>
      issueCustomerRefund(tx, {
        customerId: data.customerId,
        amount: data.amount,
        walletId: data.walletId,
        refundDate: data.refundDate,
        notes: data.notes,
        salesReturnId: data.salesReturnId,
        allowOverdraw: data.allowOverdraw,
        performedById: userId,
        permissions,
      }),
    );
  });

export const reverseCustomerRefundFn = createServerFn()
  .middleware([requireFinancePaymentReversalOrManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        refundId: z.string().min(1),
        reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return db.transaction(async (tx) =>
      reverseCustomerRefund(tx, {
        refundId: data.refundId,
        reason: data.reason,
        performedById: userId,
      }),
    );
  });
