import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses } from "@/db/schemas/finance-schema";
import { requireFinanceViewMiddleware } from "@/lib/middlewares";
import type { ExpenseMonthSummary } from "@/lib/types/finance-types";

const iso = z.string().datetime();
const live = (from: string, to: string) =>
  and(isNull(expenses.voidedAt), gte(expenses.expenseDate, parseISO(from)), lte(expenses.expenseDate, parseISO(to)));

/** The Expenses page summary strip: this month so far vs the same days last month, and the top 3 categories. */
export const getExpenseMonthSummaryFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(z.object({ currentFrom: iso, currentTo: iso, previousFrom: iso, previousTo: iso }))
  .handler(async ({ data }): Promise<ExpenseMonthSummary> => {
    const total = sql<string>`coalesce(sum(${expenses.amount}), 0)`;
    const [[current], [previous], top] = await Promise.all([
      db.select({ total }).from(expenses).where(live(data.currentFrom, data.currentTo)),
      db.select({ total }).from(expenses).where(live(data.previousFrom, data.previousTo)),
      db
        .select({ categoryId: expenses.categoryId, name: expenseCategories.name, total })
        .from(expenses)
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(live(data.currentFrom, data.currentTo))
        .groupBy(expenses.categoryId, expenseCategories.name)
        .orderBy(desc(total), expenseCategories.name)
        .limit(3),
    ]);

    return {
      currentTotal: Number(current?.total ?? 0),
      previousTotal: Number(previous?.total ?? 0),
      topCategories: top.map((row) => ({ categoryId: row.categoryId, name: row.name, total: Number(row.total) })),
    };
  });
