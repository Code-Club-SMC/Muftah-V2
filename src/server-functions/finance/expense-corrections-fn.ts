import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseEdits, expenseFieldValues, expenses, wallets } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireFinanceManageMiddleware } from "@/lib/middlewares";
import {
  describeExpenseCorrection,
  diffExpenseSnapshots,
  getExpenseLockReason,
  planExpenseWalletChanges,
} from "@/lib/finance/expense-corrections";
import type { ExpenseEditChange } from "@/lib/types/finance-types";
import {
  applyWalletChange,
  deleteExpenseFieldValues,
  dynamicFieldValueSchema,
  expenseAmountSchema,
  insertExpenseFieldValues,
  loadExpenseSnapshot,
  parseExpenseDate,
  resolveExpenseCategory,
  validateExpenseFieldValues,
  type Tx,
} from "./expense-writes.server";

/** Locks the expense row and refuses system-made or voided expenses. */
async function lockCorrectableExpense(tx: Tx, expenseId: string) {
  const [current] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).for("update");
  if (!current) throw new Error("Expense not found");
  const lockReason = getExpenseLockReason(current);
  if (lockReason) throw new Error(lockReason);
  return current;
}

/** Select options this expense already has saved; an edit may keep them even if switched off since. */
async function savedOptionIds(tx: Tx, expenseId: string): Promise<string[]> {
  const rows = await tx
    .select({ optionId: expenseFieldValues.valueOptionId })
    .from(expenseFieldValues)
    .where(and(eq(expenseFieldValues.expenseId, expenseId), isNotNull(expenseFieldValues.valueOptionId)));
  return rows.flatMap((row) => (row.optionId ? [row.optionId] : []));
}

/**
 * Two accounts can share a name, so a move between them would not show in the name-based diff.
 * Money moved must always be logged; name the accounts' ids in that case.
 */
async function ensureWalletMoveLogged(
  tx: Tx,
  edits: ExpenseEditChange[],
  fromWalletId: string,
  toWalletId: string,
): Promise<ExpenseEditChange[]> {
  if (fromWalletId === toWalletId || edits.some((edit) => edit.field === "Paid from")) return edits;
  const rows = await tx
    .select({ id: wallets.id, name: wallets.name })
    .from(wallets)
    .where(inArray(wallets.id, [fromWalletId, toWalletId]));
  const label = (id: string) => `${rows.find((row) => row.id === id)?.name ?? ""} (${id})`;
  return [...edits, { field: "Paid from", from: label(fromWalletId), to: label(toWalletId) }];
}

/**
 * Edit a manual expense at any time. Money differences are corrected on the account today,
 * and the change is logged with old and new values.
 */
export const updateExpenseFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      expenseId: z.string().min(1),
      categoryId: z.string().min(1, "Please select a category"),
      amount: expenseAmountSchema,
      walletId: z.string().min(1, "Please select a payment source"),
      payee: z.string().trim().max(200).optional(),
      description: z.string().trim().max(1000).optional().default(""),
      expenseDate: z.string().min(1, "Please pick a date"),
      slipNumber: z.string().trim().max(100).optional(),
      allowOverdraw: z.boolean().optional().default(false),
      fieldValues: z.array(dynamicFieldValueSchema).optional().default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const current = await lockCorrectableExpense(tx, data.expenseId);
      const before = await loadExpenseSnapshot(tx, current.id);

      const category = await resolveExpenseCategory(
        tx,
        { categoryId: data.categoryId },
        { allowInactiveId: current.categoryId },
      );
      const activeFieldIds = await validateExpenseFieldValues(tx, category.id, data.fieldValues, {
        keepOptionIds: category.id === current.categoryId ? await savedOptionIds(tx, current.id) : [],
      });

      const expenseDate = parseExpenseDate(data.expenseDate);
      const amount = new Big(data.amount).toFixed(2);
      const description = describeExpenseCorrection("correction", current.expenseDate);
      // Same lock order for every writer (by account id), so two crossing account moves cannot deadlock.
      const changes = planExpenseWalletChanges(
        { walletId: current.walletId, amount: current.amount },
        { walletId: data.walletId, amount },
      ).sort((left, right) => left.walletId.localeCompare(right.walletId));
      for (const change of changes) {
        await applyWalletChange(tx, change, {
          allowOverdraw: data.allowOverdraw,
          performedById: userId,
          referenceId: current.id,
          description,
        });
      }

      await tx
        .update(expenses)
        .set({
          categoryId: category.id,
          category: category.name,
          amount,
          walletId: data.walletId,
          payee: data.payee || null,
          description: data.description,
          expenseDate,
          slipNumber: data.slipNumber || null,
        })
        .where(eq(expenses.id, current.id));

      // Same category: replace only the fields the form shows, so values of fields that were
      // switched off later are kept. New category: the old category's values no longer apply.
      await deleteExpenseFieldValues(
        tx,
        current.id,
        category.id === current.categoryId ? activeFieldIds : undefined,
      );
      await insertExpenseFieldValues(tx, current.id, data.fieldValues);

      const edits = await ensureWalletMoveLogged(
        tx,
        diffExpenseSnapshots(before, await loadExpenseSnapshot(tx, current.id)),
        current.walletId,
        data.walletId,
      );
      if (edits.length === 0) return { changed: false };

      await tx.insert(expenseEdits).values({ expenseId: current.id, editedById: userId, changes: edits });

      logActivityQuiet({
        module: "finance",
        action: "updated",
        entityType: "expense",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Edited expense: ${edits.map((e) => e.field).join(", ")}`,
      });

      return { changed: true };
    });
  });

/** Void a manual expense: the money goes back to its account today; the row stays, marked voided. */
export const voidExpenseFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      expenseId: z.string().min(1),
      reason: z.string().trim().min(3, "Please give a reason").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const current = await lockCorrectableExpense(tx, data.expenseId);

      // The current amount and account already include every earlier correction.
      const voidTransactionId = await applyWalletChange(
        tx,
        { walletId: current.walletId, type: "credit", amount: new Big(current.amount).toFixed(2) },
        {
          allowOverdraw: true,
          performedById: userId,
          referenceId: current.id,
          description: describeExpenseCorrection("void", current.expenseDate),
        },
      );

      const [voided] = await tx
        .update(expenses)
        .set({ voidedAt: new Date(), voidedById: userId, voidReason: data.reason, voidTransactionId })
        .where(eq(expenses.id, current.id))
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "expense",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Voided expense of ${current.amount}: ${data.reason}`,
      });

      return voided;
    });
  });
