// src/__tests__/integration/expense-templates.test.ts
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenseTemplates } from "@/db/schemas/finance-schema";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { createExpenseFn } from "@/server-functions/finance-fn";
import { voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import {
  archiveExpenseTemplateFn,
  listExpenseTemplatesFn,
  saveExpenseTemplateFn,
  skipExpenseTemplateMonthFn,
} from "@/server-functions/finance/expense-templates-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => async (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

// October 2026, which holds EXPENSE_DAY (12 Oct).
const WINDOW = { windowFrom: "2026-10-01T00:00:00.000Z", windowTo: "2026-11-30T23:59:59.999Z" };

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense templates", () => {
  const call = <T,>(fn: unknown, data: unknown, context: unknown) =>
    (fn as (input: unknown) => Promise<T>)({ data, context });

  it("saves a template and lists it with the expenses recorded from it, leaving voided ones out", async () => {
    const f = await expenseFixture();
    const { id: templateId } = await call<{ id: string }>(saveExpenseTemplateFn, {
      name: `Shop rent ${f.id}`,
      categoryId: f.rent.id,
      amount: 85000,
      payee: "Landlord",
      walletId: f.cash.id,
      reminderDay: 1,
    }, f.context);

    const kept = await call<{ id: string }>(createExpenseFn, {
      categoryId: f.rent.id, amount: 8500, walletId: f.bank.id, expenseDate: EXPENSE_DAY, templateId,
    }, f.context);
    const voided = await call<{ id: string }>(createExpenseFn, {
      categoryId: f.rent.id, amount: 8500, walletId: f.bank.id, expenseDate: EXPENSE_DAY, templateId,
    }, f.context);
    await call(voidExpenseFn, { expenseId: voided.id, reason: "Entered twice" }, f.context);

    const mine = (await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context)).find((t) => t.id === templateId);
    expect(mine).toMatchObject({
      name: `Shop rent ${f.id}`,
      categoryId: f.rent.id,
      categoryName: f.rent.name,
      amount: "85000.00",
      payee: "Landlord",
      walletId: f.cash.id,
      reminderDay: 1,
      skippedMonth: null,
    });
    expect(mine?.expenseDates).toHaveLength(1);
    expect((await f.expense(kept.id)).templateId).toBe(templateId);
  });

  it("only returns expenses inside the window", async () => {
    const f = await expenseFixture();
    const { id: templateId } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Fuel ${f.id}`, categoryId: f.fuel.id }, f.context);
    await call(createExpenseFn, { categoryId: f.fuel.id, amount: 500, walletId: f.cash.id, expenseDate: "2026-09-15T05:00:00.000Z", templateId }, f.context);
    const mine = (await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context)).find((t) => t.id === templateId);
    expect(mine?.expenseDates).toEqual([]);
    expect(mine?.amount).toBeNull();
  });

  it("edits a template and keeps blank optional fields as empty", async () => {
    const f = await expenseFixture();
    const { id } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Rent ${f.id}`, categoryId: f.rent.id, amount: 1000, reminderDay: 5 }, f.context);
    await call(saveExpenseTemplateFn, { templateId: id, name: `Rent ${f.id} B`, categoryId: f.rent.id, amount: null, reminderDay: null, payee: "  " }, f.context);
    const [row] = await db.select().from(expenseTemplates).where(eq(expenseTemplates.id, id));
    expect(row).toMatchObject({ name: `Rent ${f.id} B`, amount: null, reminderDay: null, payee: null });
  });

  it("refuses a reminder day outside 1-31", async () => {
    const f = await expenseFixture();
    await expect(call(saveExpenseTemplateFn, { name: "x", categoryId: f.rent.id, reminderDay: 32 }, f.context)).rejects.toThrow();
  });

  it("skips one month", async () => {
    const f = await expenseFixture();
    const { id } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Rent ${f.id}`, categoryId: f.rent.id, reminderDay: 1 }, f.context);
    await call(skipExpenseTemplateMonthFn, { templateId: id, monthKey: "2026-10" }, f.context);
    const mine = (await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context)).find((t) => t.id === id);
    expect(mine?.skippedMonth).toBe("2026-10");
    await expect(call(skipExpenseTemplateMonthFn, { templateId: id, monthKey: "Oct" }, f.context)).rejects.toThrow();
  });

  it("archives a template: hidden from the list, refused when recording or editing, old expenses kept", async () => {
    const f = await expenseFixture();
    const { id } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Rent ${f.id}`, categoryId: f.rent.id }, f.context);
    const kept = await call<{ id: string }>(createExpenseFn, { categoryId: f.rent.id, amount: 100, walletId: f.cash.id, expenseDate: EXPENSE_DAY, templateId: id }, f.context);
    await call(archiveExpenseTemplateFn, { templateId: id }, f.context);

    const list = await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context);
    expect(list.some((t) => t.id === id)).toBe(false);
    await expect(
      call(createExpenseFn, { categoryId: f.rent.id, amount: 100, walletId: f.cash.id, expenseDate: EXPENSE_DAY, templateId: id }, f.context),
    ).rejects.toThrow("This template was deleted");
    await expect(call(saveExpenseTemplateFn, { templateId: id, name: "x", categoryId: f.rent.id }, f.context)).rejects.toThrow("This template was deleted");
    expect((await f.expense(kept.id)).templateId).toBe(id);
  });

  it("refuses a switched-off category on a new template", async () => {
    const f = await expenseFixture();
    const { expenseCategories } = await import("@/db/schemas/finance-schema");
    await db.update(expenseCategories).set({ isActive: false }).where(eq(expenseCategories.id, f.fuel.id));
    await expect(call(saveExpenseTemplateFn, { name: "x", categoryId: f.fuel.id }, f.context)).rejects.toThrow("That category is switched off");
  });
});
