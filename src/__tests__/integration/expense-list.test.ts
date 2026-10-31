import { describe, expect, it, vi } from "vitest";
import type { ExpenseListResponse } from "@/lib/types/finance-types";
import { createExpenseFn, getExpensesFn } from "@/server-functions/finance-fn";
import { updateExpenseFn, voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
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

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense list", () => {
  it("shows payee, origin, void details and edit history, newest edit first", async () => {
    const f = await expenseFixture();
    const { id } = (await createExpenseFn({
      data: { categoryId: f.fuel.id, amount: 5000, walletId: f.cash.id, payee: "LESCO", expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never)) as { id: string };
    const update = (amount: number) =>
      updateExpenseFn({
        data: { expenseId: id, categoryId: f.fuel.id, amount, walletId: f.cash.id, payee: "LESCO", expenseDate: EXPENSE_DAY },
        context: f.context,
      } as never);
    await update(5500);
    await update(6000);
    await voidExpenseFn({ data: { expenseId: id, reason: "Paid by the landlord" }, context: f.context } as never);

    const list = (await getExpensesFn({ data: { categoryId: f.fuel.id }, context: f.context } as never)) as ExpenseListResponse;
    const [row] = list.data;

    expect(list.total).toBe(1);
    expect(row).toMatchObject({
      id,
      payee: "LESCO",
      origin: "manual",
      voidReason: "Paid by the landlord",
      voidedBy: { id: f.actor.id, name: "Accountant" },
    });
    expect(row.voidedAt).not.toBeNull();
    expect(row.edits.map((edit) => edit.changes)).toEqual([
      [{ field: "Amount", from: "Rs 5,500", to: "Rs 6,000" }],
      [{ field: "Amount", from: "Rs 5,000", to: "Rs 5,500" }],
    ]);
    expect(row.edits[0].editor).toEqual({ id: f.actor.id, name: "Accountant" });
  });
});
