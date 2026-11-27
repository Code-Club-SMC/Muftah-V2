// src/server-functions/finance/expense-templates-fn.ts
import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses, expenseTemplates, wallets } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireFinanceManageMiddleware } from "@/lib/middlewares";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { expenseAmountSchema, lockActiveTemplate } from "./expense-writes.server";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const saveTemplateSchema = z.object({
  templateId: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Give the template a name").max(120),
  categoryId: z.string().min(1, "Pick what the money was for"),
  amount: expenseAmountSchema.nullish(),
  payee: optionalText(200),
  walletId: z.string().min(1).nullish(),
  note: optionalText(1000),
  reminderDay: z.number().int().min(1).max(31).nullish(),
});

/** Active templates by name, each with the live expenses recorded from it inside the window. */
export const listExpenseTemplatesFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ windowFrom: z.string().datetime(), windowTo: z.string().datetime() }))
  .handler(async ({ data }): Promise<ExpenseTemplate[]> => {
    const rows = await db
      .select({
        id: expenseTemplates.id,
        name: expenseTemplates.name,
        categoryId: expenseTemplates.categoryId,
        categoryName: expenseCategories.name,
        amount: expenseTemplates.amount,
        payee: expenseTemplates.payee,
        walletId: expenseTemplates.walletId,
        note: expenseTemplates.note,
        reminderDay: expenseTemplates.reminderDay,
        skippedMonth: expenseTemplates.skippedMonth,
      })
      .from(expenseTemplates)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseTemplates.categoryId))
      .where(isNull(expenseTemplates.archivedAt))
      .orderBy(asc(expenseTemplates.name), asc(expenseTemplates.id));
    if (rows.length === 0) return [];

    const used = await db
      .select({ templateId: expenses.templateId, expenseDate: expenses.expenseDate })
      .from(expenses)
      .where(
        and(
          inArray(expenses.templateId, rows.map((row) => row.id)),
          isNull(expenses.voidedAt),
          gte(expenses.expenseDate, parseISO(data.windowFrom)),
          lte(expenses.expenseDate, parseISO(data.windowTo)),
        ),
      );

    return rows.map((row) => ({
      ...row,
      expenseDates: used
        .filter((expense) => expense.templateId === row.id)
        .map((expense) => expense.expenseDate.toISOString()),
    }));
  });

/** Creates a template, or edits one when `templateId` is given. */
export const saveExpenseTemplateFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(saveTemplateSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const current = data.templateId ? await lockActiveTemplate(tx, data.templateId) : null;

      // A new template, or a category change, must use a category people can still pick.
      if (!current || current.categoryId !== data.categoryId) {
        const [category] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, data.categoryId));
        if (!category) throw new Error("Category not found");
        if (!category.isActive || category.isArchived) throw new Error("That category is switched off");
      }
      if (data.walletId) {
        const [wallet] = await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, data.walletId));
        if (!wallet) throw new Error("Account not found");
      }

      const values = {
        name: data.name,
        categoryId: data.categoryId,
        amount: data.amount == null ? null : new Big(data.amount).toFixed(2),
        payee: data.payee,
        walletId: data.walletId ?? null,
        note: data.note,
        reminderDay: data.reminderDay ?? null,
      };

      const [saved] = current
        ? await tx.update(expenseTemplates).set(values).where(eq(expenseTemplates.id, current.id)).returning({ id: expenseTemplates.id })
        : await tx
            .insert(expenseTemplates)
            .values({ ...values, createdById: context.session.user.id })
            .returning({ id: expenseTemplates.id });

      logActivityQuiet({
        module: "finance",
        action: current ? "updated" : "created",
        entityType: "expense_template",
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `${current ? "Edited" : "Saved"} expense template "${data.name}"`,
      });
      return saved;
    });
  });

export const archiveExpenseTemplateFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ templateId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const template = await lockActiveTemplate(tx, data.templateId);
      await tx.update(expenseTemplates).set({ archivedAt: new Date() }).where(eq(expenseTemplates.id, template.id));
      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "expense_template",
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `Deleted expense template "${template.name}"`,
      });
      return { id: template.id };
    });
  });

export const skipExpenseTemplateMonthFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ templateId: z.string().min(1), monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const template = await lockActiveTemplate(tx, data.templateId);
      await tx.update(expenseTemplates).set({ skippedMonth: data.monthKey }).where(eq(expenseTemplates.id, template.id));
      return { id: template.id };
    });
  });
