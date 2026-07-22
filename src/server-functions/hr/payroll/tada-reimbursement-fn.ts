/**
 * TA/DA Reimbursement Server Functions
 * Standalone batch reimbursement workflow for approved travel logs.
 * Integrates with finance module for expense tracking.
 */

import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { travelLogs } from "@/db/schemas/hr-schema";
import { expenses, wallets, transactions } from "@/db/schemas/finance-schema";
import {
  requireHrManageMiddleware,
  requireHrViewMiddleware,
} from "@/lib/middlewares";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";

const batchReimburseSchema = z.object({
  travelLogIds: z.array(z.string()).min(1, "Select at least one travel log"),
  walletId: z.string().min(1, "Wallet is required"),
  expenseCategoryId: z.string().min(1, "Expense category is required"),
  performedAt: z.string().optional(), // YYYY-MM-DD
  remarks: z.string().optional(),
});

/**
 * Batch reimburse approved TA/DA logs.
 * Creates finance expense entries and optionally debits a wallet.
 */
export const batchReimburseTadaFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(batchReimburseSchema)
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;
    const selectedLogIds = [...new Set(data.travelLogIds)];

    return await db.transaction(async (tx) => {
      const logs = await tx.query.travelLogs.findMany({
        where: and(
          inArray(travelLogs.id, selectedLogIds),
          eq(travelLogs.status, "approved"),
          isNull(travelLogs.reimbursedAt),
        ),
      });

      if (logs.length !== selectedLogIds.length) {
        throw new Error(
          "Some selected TA/DA logs are no longer eligible for reimbursement.",
        );
      }

      const totalAmount = logs.reduce(
        (sum, log) => sum + parseFloat(log.totalAmount || "0"),
        0,
      );

      const [wallet] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${totalAmount}` })
        .where(
          and(
            eq(wallets.id, data.walletId),
            gte(wallets.balance, totalAmount.toString()),
          ),
        )
        .returning({
          id: wallets.id,
          name: wallets.name,
        });

      if (!wallet) {
        const existingWallet = await tx.query.wallets.findFirst({
          where: eq(wallets.id, data.walletId),
        });
        if (!existingWallet) throw new Error("Selected wallet not found");

        const available = parseFloat(existingWallet.balance || "0");
        throw new Error(
          `Insufficient wallet balance. Available: PKR ${Math.round(available).toLocaleString()}, Required: PKR ${Math.round(totalAmount).toLocaleString()}`,
        );
      }

      const expenseId = createId();

      await tx.insert(expenses).values({
        id: expenseId,
        categoryId: data.expenseCategoryId,
        category: "TA/DA Reimbursement",
        amount: totalAmount.toString(),
        expenseDate: data.performedAt ? new Date(data.performedAt) : new Date(),
        description: `TA/DA Reimbursement batch: ${logs.length} entries`,
        walletId: data.walletId,
        performedById: userId,
        remarks: data.remarks || null,
      });

      await tx.insert(transactions).values({
        id: createId(),
        walletId: data.walletId,
        type: "debit",
        amount: totalAmount.toString(),
        source: "TA/DA Reimbursement",
        referenceId: expenseId,
        performedById: userId,
      });

      const reimbursedAt = new Date();
      const updatedLogs = await tx
        .update(travelLogs)
        .set({
          status: "reimbursed",
          reimbursedAt,
          reimbursedBy: userId,
          reimbursedVia: "wallet",
          reimbursedAmount: sql`${travelLogs.totalAmount}`,
        })
        .where(
          and(
            inArray(travelLogs.id, selectedLogIds),
            eq(travelLogs.status, "approved"),
            isNull(travelLogs.reimbursedAt),
          ),
        )
        .returning({ id: travelLogs.id });

      if (updatedLogs.length !== selectedLogIds.length) {
        throw new Error(
          "TA/DA reimbursement failed because selected logs changed during processing.",
        );
      }

      return {
        reimbursedCount: logs.length,
        totalAmount,
        method: "wallet",
      };
    });
  });

/**
 * List approved but unreimbursed TA/DA logs (eligible for reimbursement)
 */
export const listPendingTadaReimbursementsFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator((input: any) =>
    ({ employeeId: input.employeeId } as { employeeId?: string }),
  )
  .handler(async ({ data }) => {
    const conditions = [eq(travelLogs.status, "approved"), isNull(travelLogs.reimbursedAt)];

    if (data.employeeId) {
      conditions.push(eq(travelLogs.employeeId, data.employeeId));
    }

    return db.query.travelLogs.findMany({
      where: and(...conditions),
      orderBy: [travelLogs.date],
      with: {
        employee: { columns: { id: true, firstName: true, lastName: true } },
      },
    });
  });

/**
 * List already-reimbursed TA/DA logs
 */
export const listReimbursedTadaLogsFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator((input: any) =>
    ({ limit: input.limit ?? 50, offset: input.offset ?? 0 } as {
      limit: number;
      offset: number;
    }),
  )
  .handler(async ({ data }) => {
    return db.query.travelLogs.findMany({
      where: eq(travelLogs.status, "reimbursed"),
      orderBy: [travelLogs.reimbursedAt],
      limit: data.limit,
      offset: data.offset,
      with: {
        employee: { columns: { id: true, firstName: true, lastName: true } },
        reimbursedByUser: {
          columns: { id: true, name: true },
        },
      },
    });
  });
