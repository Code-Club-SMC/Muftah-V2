import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, expenses } from "@/db";
import { expenseCategories } from "@/db/schemas/finance-schema";
import { OVERDRAW_CONFIRM_REQUIRED } from "@/lib/finance/expense-corrections";
import type { ExpenseEntryDefaults } from "@/lib/types/finance-types";
import { createExpenseFn } from "@/server-functions/finance-fn";
import { getExpenseEntryDefaultsFn } from "@/server-functions/finance/expense-entry-defaults-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("recording expenses", () => {
  it("records a manual expense with a payee and no note, and takes the money from the account", async () => {
    const f = await expenseFixture();
    const created = (await createExpenseFn({
      data: { categoryId: f.fuel.id, amount: 2500, walletId: f.cash.id, payee: "  Shell Pump Ravi Road ", expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never)) as { id: string };

    expect(await f.expense(created.id)).toMatchObject({
      amount: "2500.00", payee: "Shell Pump Ravi Road", description: "", origin: "manual", voidedAt: null,
    });
    expect(await f.balanceOf(f.cash.id)).toBe("7500.00");
    expect((await f.moves(created.id)).map((m) => [m.type, m.amount, m.source, m.description])).toEqual([
      ["debit", "2500.00", "Expense", null],
    ]);
  });

  it("stores a blank payee as empty, not as spaces", async () => {
    const f = await expenseFixture();
    const created = (await createExpenseFn({
      data: { categoryId: f.fuel.id, amount: 10, walletId: f.cash.id, payee: "   ", expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never)) as { id: string };
    expect((await f.expense(created.id)).payee).toBeNull();
  });

  it("asks for confirmation before taking an account below zero", async () => {
    const f = await expenseFixture("2000.00");
    const data = { categoryId: f.fuel.id, amount: 5000, walletId: f.cash.id, expenseDate: EXPENSE_DAY };

    await expect(createExpenseFn({ data, context: f.context } as never)).rejects.toThrow(OVERDRAW_CONFIRM_REQUIRED);
    expect(await f.balanceOf(f.cash.id)).toBe("2000.00");
    expect(await db.select().from(expenses).where(eq(expenses.walletId, f.cash.id))).toEqual([]);

    await createExpenseFn({ data: { ...data, allowOverdraw: true }, context: f.context } as never);
    expect(await f.balanceOf(f.cash.id)).toBe("-3000.00");
  });

  it("lets an expense take the account to exactly zero without asking", async () => {
    const f = await expenseFixture("2000.00");
    await createExpenseFn({
      data: { categoryId: f.fuel.id, amount: 2000, walletId: f.cash.id, expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never);
    expect(await f.balanceOf(f.cash.id)).toBe("0.00");
  });

  it("refuses amounts that round to nothing, switched-off categories, bad dates and unknown accounts", async () => {
    const f = await expenseFixture();
    const base = { categoryId: f.fuel.id, amount: 100, walletId: f.cash.id, expenseDate: EXPENSE_DAY };
    const create = async (data: Record<string, unknown>) => createExpenseFn({ data: { ...base, ...data }, context: f.context } as never);

    await expect(create({ amount: 0.004 })).rejects.toThrow();
    await expect(create({ amount: 10_000_000_000 })).rejects.toThrow();
    await expect(create({ expenseDate: "not a date" })).rejects.toThrow("Invalid expense date");
    await expect(create({ walletId: "missing-wallet" })).rejects.toThrow("Wallet not found");
    await db.update(expenseCategories).set({ isActive: false }).where(eq(expenseCategories.id, f.rent.id));
    await expect(create({ categoryId: f.rent.id })).rejects.toThrow("Please select an active category");

    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
  });

  it("suggests this user's last account, their most used categories and past payees", async () => {
    const f = await expenseFixture();
    const record = (categoryId: string, walletId: string, payee: string) =>
      createExpenseFn({ data: { categoryId, amount: 100, walletId, payee, expenseDate: EXPENSE_DAY }, context: f.context } as never);
    await record(f.rent.id, f.cash.id, `Landlord ${f.actor.id}`);
    await record(f.fuel.id, f.cash.id, `pump ${f.actor.id}`);
    await record(f.fuel.id, f.bank.id, `Pump ${f.actor.id}`);

    const defaults = (await getExpenseEntryDefaultsFn({ context: f.context } as never)) as ExpenseEntryDefaults;

    expect(defaults.lastWalletId).toBe(f.bank.id);
    expect(defaults.categoryUsageRank).toEqual([f.fuel.id, f.rent.id]);
    expect(defaults.payees).toEqual(expect.arrayContaining([`Landlord ${f.actor.id}`, `Pump ${f.actor.id}`]));
    expect(defaults.payees.filter((p) => p.toLowerCase() === `pump ${f.actor.id}`)).toEqual([`Pump ${f.actor.id}`]);
  });

  it("has nothing to suggest for a user who never recorded an expense", async () => {
    const f = await expenseFixture();
    const defaults = (await getExpenseEntryDefaultsFn({ context: f.context } as never)) as ExpenseEntryDefaults;
    expect(defaults.lastWalletId).toBeNull();
    expect(defaults.categoryUsageRank).toEqual([]);
  });
});
