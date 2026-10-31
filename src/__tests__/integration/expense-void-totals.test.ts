import { describe, expect, it, vi } from "vitest";
import type { ExpenseKpis } from "@/lib/types/finance-types";
import { createExpenseFn, getExpensesKpisFn } from "@/server-functions/finance-fn";
import { voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { getExpensesReportFn } from "@/server-functions/reports/expenses-report-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | ((data: unknown) => unknown) | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({
        ...input,
        data: typeof validator === "function" ? validator(input.data) : validator ? validator.parse(input.data) : input.data,
      }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({
  requireFinanceManageMiddleware: {},
  requireFinanceViewMiddleware: {},
  requireReportsViewMiddleware: {},
  requireSuperAdminMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense totals", () => {
  it("leave voided expenses out", async () => {
    const f = await expenseFixture();
    const record = async (amount: number) =>
      (await createExpenseFn({ data: { categoryId: f.fuel.id, amount, walletId: f.cash.id, expenseDate: EXPENSE_DAY }, context: f.context } as never)) as { id: string };
    const kept = await record(1000);
    const mistake = await record(2000);
    await voidExpenseFn({ data: { expenseId: mistake.id, reason: "Entered twice" }, context: f.context } as never);

    const kpis = (await getExpensesKpisFn({ data: { categoryId: f.fuel.id }, context: f.context } as never)) as ExpenseKpis;
    expect(kpis).toEqual({ totalRecords: 1, totalCash: 1000, avgCashPerRecord: 1000 });

    const report = (await getExpensesReportFn({ data: { dateFrom: "2026-10-12", dateTo: "2026-10-12" }, context: f.context } as never)) as {
      financeExpenses: Array<{ expenseId: string }>;
    };
    const ids = report.financeExpenses.map((row) => row.expenseId);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(mistake.id);
  });
});
