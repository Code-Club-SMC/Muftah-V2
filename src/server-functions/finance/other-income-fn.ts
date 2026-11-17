import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schemas/auth-schema";
import { otherIncome, transactions, wallets } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { formatRupees } from "@/lib/finance/expense-entry";
import {
  MAX_OTHER_INCOME_AMOUNT,
  normalizeItemName,
  OTHER_INCOME_TX_SOURCE,
  otherIncomeAmount,
} from "@/lib/finance/other-income";
import { requireFinanceManageMiddleware, requireFinanceViewMiddleware } from "@/lib/middlewares";
import { reportDateBounds, reportMonth } from "@/lib/report-dates";
import { parseExpenseDate, type Tx } from "./expense-writes.server";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month");

/**
 * Adds or removes money on one account and writes its ledger row. A debit is refused when the
 * account holds less than the amount; the balance check and update are one row-locking statement.
 */
async function moveWalletMoney(
  tx: Tx,
  input: {
    walletId: string;
    type: "credit" | "debit";
    amount: string;
    referenceId: string;
    performedById: string;
    description: string;
  },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance:
        input.type === "credit"
          ? sql`${wallets.balance} + ${input.amount}`
          : sql`${wallets.balance} - ${input.amount}`,
    })
    .where(
      input.type === "debit"
        ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
        : eq(wallets.id, input.walletId),
    )
    .returning({ id: wallets.id });

  if (!wallet) {
    const existing = await tx.query.wallets.findFirst({
      where: eq(wallets.id, input.walletId),
      columns: { name: true, balance: true },
    });
    if (!existing) throw new Error("Account not found");
    throw new Error(
      `${existing.name} has only ${formatRupees(existing.balance)}. Voiding would take it below zero.`,
    );
  }

  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    source: OTHER_INCOME_TX_SOURCE,
    referenceId: input.referenceId,
    description: input.description,
    performedById: input.performedById,
  });
  return id;
}

export const getOtherIncomeFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(z.object({ month: monthSchema }))
  .handler(async ({ data }) => {
    const { from, to } = reportMonth(`${data.month}-01`);
    const { fromDate, toDate } = reportDateBounds({ dateFrom: from, dateTo: to });
    const rows = await db
      .select({
        id: otherIncome.id,
        incomeDate: otherIncome.incomeDate,
        itemName: otherIncome.itemName,
        quantity: otherIncome.quantity,
        unitPrice: otherIncome.unitPrice,
        amount: otherIncome.amount,
        note: otherIncome.note,
        walletName: wallets.name,
        recordedBy: user.name,
        voidedAt: otherIncome.voidedAt,
        voidReason: otherIncome.voidReason,
      })
      .from(otherIncome)
      .leftJoin(wallets, eq(otherIncome.walletId, wallets.id))
      .leftJoin(user, eq(otherIncome.performedById, user.id))
      .where(and(gte(otherIncome.incomeDate, fromDate!), lte(otherIncome.incomeDate, toDate!)))
      .orderBy(desc(otherIncome.incomeDate), desc(otherIncome.createdAt));

    const total = rows
      .filter((row) => row.voidedAt === null)
      .reduce((sum, row) => sum.plus(row.amount), new Big(0));
    return { rows, total: total.toFixed(2) };
  });

export const getOtherIncomeItemNamesFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .handler(async () => {
    const rows = await db
      .selectDistinct({ itemName: otherIncome.itemName })
      .from(otherIncome)
      .where(isNull(otherIncome.voidedAt))
      .orderBy(asc(otherIncome.itemName));
    return rows.map((row) => row.itemName);
  });

export const createOtherIncomeFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      incomeDate: z.string().min(1, "Please pick a date"),
      itemName: z
        .string()
        .transform(normalizeItemName)
        .pipe(z.string().min(1, "Please enter the item").max(120, "Item name is too long")),
      quantity: z
        .number()
        .finite()
        .positive("Quantity must be above zero")
        .max(999_999_999)
        .refine((value) => new Big(value).round(3).eq(value), "Quantity can have at most 3 decimals"),
      unitPrice: z
        .number()
        .finite()
        .positive("Price must be above zero")
        .max(MAX_OTHER_INCOME_AMOUNT)
        .refine((value) => new Big(value).round(2).eq(value), "Price can have at most 2 decimals (paisa)"),
      walletId: z.string().min(1, "Please pick the account"),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const incomeDate = parseExpenseDate(data.incomeDate);
    const quantity = new Big(data.quantity);
    if (!quantity.gt(0)) throw new Error("Quantity must be above zero");
    const unitPrice = new Big(data.unitPrice);
    if (!unitPrice.gt(0)) throw new Error("Price must be above zero");
    const amount = otherIncomeAmount(quantity.toFixed(3), unitPrice.toFixed(2));
    const userId = context.session.user.id;
    const id = createId();

    return await db.transaction(async (tx) => {
      const transactionId = await moveWalletMoney(tx, {
        walletId: data.walletId,
        type: "credit",
        amount,
        referenceId: id,
        performedById: userId,
        description: `Other income: ${data.itemName}`,
      });

      const [row] = await tx
        .insert(otherIncome)
        .values({
          id,
          incomeDate,
          itemName: data.itemName,
          quantity: quantity.toFixed(3),
          unitPrice: unitPrice.toFixed(2),
          amount,
          note: data.note || null,
          walletId: data.walletId,
          transactionId,
          performedById: userId,
        })
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "other_income",
        entityId: id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Recorded other income of ${amount} for ${data.itemName}`,
      });

      return row;
    });
  });

export const voidOtherIncomeFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      reason: z.string().trim().min(3, "Please give a reason").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(otherIncome)
        .where(eq(otherIncome.id, data.id))
        .for("update");
      if (!current) throw new Error("Income entry not found");
      if (current.voidedAt) throw new Error("This entry is already voided");

      const voidTransactionId = await moveWalletMoney(tx, {
        walletId: current.walletId,
        type: "debit",
        amount: current.amount,
        referenceId: current.id,
        performedById: userId,
        description: `Void of other income: ${current.itemName}`,
      });

      const [voided] = await tx
        .update(otherIncome)
        .set({ voidedAt: new Date(), voidedById: userId, voidReason: data.reason, voidTransactionId })
        .where(eq(otherIncome.id, current.id))
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "other_income",
        entityId: current.id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Voided other income of ${current.amount}: ${data.reason}`,
      });

      return voided;
    });
  });
