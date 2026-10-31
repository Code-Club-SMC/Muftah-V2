import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schemas/finance-schema";
import { requireFinanceManageMiddleware } from "@/lib/middlewares";
import { QUICK_CATEGORY_COUNT } from "@/lib/finance/expense-entry";
import type { ExpenseEntryDefaults } from "@/lib/types/finance-types";

const PAYEE_SUGGESTION_LIMIT = 200;

/** Newest first; "LESCO" and "lesco " count as one name (the newest spelling wins). */
function uniquePayees(names: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * What the Record expense form pre-fills: this user's last account and most used categories,
 * plus payee names anyone has used before (newest first).
 */
export const getExpenseEntryDefaultsFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .handler(async ({ context }): Promise<ExpenseEntryDefaults> => {
    const mine = and(eq(expenses.performedById, context.session.user.id), eq(expenses.origin, "manual"));
    const uses = sql<number>`count(*)`;
    const lastUsed = sql<Date>`max(${expenses.createdAt})`;

    const [[last], categoryRows, payeeRows] = await Promise.all([
      db
        .select({ walletId: expenses.walletId })
        .from(expenses)
        .where(mine)
        .orderBy(desc(expenses.createdAt), desc(expenses.id))
        .limit(1),
      db
        .select({ categoryId: expenses.categoryId, uses })
        .from(expenses)
        .where(and(mine, isNull(expenses.voidedAt)))
        .groupBy(expenses.categoryId)
        .orderBy(desc(uses), expenses.categoryId)
        // Extra rows so the form can skip categories switched off since and still fill the tiles.
        .limit(QUICK_CATEGORY_COUNT * 2),
      db
        .select({ payee: expenses.payee, lastUsed })
        .from(expenses)
        .where(and(isNotNull(expenses.payee), ne(expenses.payee, ""), isNull(expenses.voidedAt)))
        .groupBy(expenses.payee)
        .orderBy(desc(lastUsed))
        .limit(PAYEE_SUGGESTION_LIMIT),
    ]);

    return {
      lastWalletId: last?.walletId ?? null,
      categoryUsageRank: categoryRows.map((row) => row.categoryId),
      payees: uniquePayees(payeeRows.map((row) => row.payee)),
    };
  });
