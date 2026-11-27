// src/__tests__/integration/expense-list-filters.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ExpenseKpis, ExpenseListResponse, ExpenseMonthSummary } from "@/lib/types/finance-types";
import { createExpenseFn, getExpensesFn, getExpensesKpisFn } from "@/server-functions/finance-fn";
import { voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { getExpenseMonthSummaryFn } from "@/server-functions/finance/expense-summary-fn";
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

const call = <T,>(fn: unknown, data: unknown, context: unknown) => (fn as (input: unknown) => Promise<T>)({ data, context });

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense list filters", () => {
  it("filters by several categories, one account and part of the payee name", async () => {
    const f = await expenseFixture();
    const add = (categoryId: string, walletId: string, payee: string, amount: number) =>
      call<{ id: string }>(createExpenseFn, { categoryId, walletId, payee, amount, expenseDate: EXPENSE_DAY }, f.context);
    await add(f.fuel.id, f.cash.id, `Shell Pump ${f.id}`, 100);
    await add(f.rent.id, f.bank.id, `Landlord ${f.id}`, 200);
    const voided = await add(f.rent.id, f.cash.id, `Landlord ${f.id}`, 300);
    await call(voidExpenseFn, { expenseId: voided.id, reason: "Twice" }, f.context);

    const list = (data: object) => call<ExpenseListResponse>(getExpensesFn, data, f.context);
    const kpis = (data: object) => call<ExpenseKpis>(getExpensesKpisFn, data, f.context);
    const both = { categoryIds: [f.fuel.id, f.rent.id] };

    expect((await list(both)).total).toBe(3);
    expect((await list({ ...both, walletId: f.cash.id })).total).toBe(2);
    expect((await list({ ...both, payee: `landlord ${f.id}`.toUpperCase() })).total).toBe(2);
    expect((await list({ ...both, payee: "100%_" })).total).toBe(0);
    // Voided rows stay in the list (struck through) but not in the money total.
    expect(await kpis({ ...both, payee: `Landlord ${f.id}` })).toMatchObject({ totalRecords: 1, totalCash: 200 });
  });

  it("sums this month and last month and names the top 3 categories, voided left out", async () => {
    const f = await expenseFixture();
    // Summary is company-wide and rows stay in titan_test, so each run uses its own far-future year.
    const year = 2100 + Math.floor(Math.random() * 7000);
    const add = (categoryId: string, amount: number, day: string) =>
      call<{ id: string }>(createExpenseFn, { categoryId, walletId: f.bank.id, amount, expenseDate: day }, f.context);
    await add(f.fuel.id, 1000, `${year}-03-05T05:00:00.000Z`);
    await add(f.rent.id, 5000, `${year}-03-06T05:00:00.000Z`);
    const voided = await add(f.rent.id, 9000, `${year}-03-07T05:00:00.000Z`);
    await call(voidExpenseFn, { expenseId: voided.id, reason: "Twice" }, f.context);
    await add(f.fuel.id, 2000, `${year}-02-04T05:00:00.000Z`);

    const summary = await call<ExpenseMonthSummary>(getExpenseMonthSummaryFn, {
      currentFrom: `${year}-03-01T00:00:00.000Z`,
      currentTo: `${year}-03-10T23:59:59.999Z`,
      previousFrom: `${year}-02-01T00:00:00.000Z`,
      previousTo: `${year}-02-10T23:59:59.999Z`,
    }, f.context);

    expect(summary.currentTotal).toBe(6000);
    expect(summary.previousTotal).toBe(2000);
    expect(summary.topCategories).toEqual([
      { categoryId: f.rent.id, name: f.rent.name, total: 5000 },
      { categoryId: f.fuel.id, name: f.fuel.name, total: 1000 },
    ]);
  });
});
