import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { paySalaries } from "@/server-functions/hr/payroll/salary-payments.server";
import { getTransactionsFn } from "@/server-functions/finance-fn";
import { salaryFixture } from "./salary-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator | ((input: unknown) => unknown)) => {
      validator = typeof schema === "function" ? { parse: schema as (input: unknown) => unknown } : schema;
      return builder;
    },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context?: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({
  requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {},
  requireHrManageMiddleware: {}, requireHrViewMiddleware: {}, requireReportsViewMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

type Fixture = Awaited<ReturnType<typeof salaryFixture>>;
const payOne = (f: Fixture, index: number, paymentDate: string) =>
  db.transaction((tx) => paySalaries(tx, { ...f.base, employeeIds: [f.staff[index].employee.id], walletId: f.cash.id, paymentDate }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("salary payments on the Ledger", () => {
  it("finds payroll lines with the Payroll filter, newest payment date first", async () => {
    const f = await salaryFixture();
    await payOne(f, 1, `${f.year}-11-30`); // entered first, paid later
    await payOne(f, 0, `${f.year}-11-28`); // entered second, back-dated earlier

    const result = (await getTransactionsFn({ data: { source: "Payroll", walletId: f.cash.id } } as never)) as { data: { description: string | null }[] };
    expect(result.data.map((t) => t.description)).toEqual([
      `Salary — ${f.staff[1].name} — Nov ${f.year}`,
      `Salary — ${f.staff[0].name} — Nov ${f.year}`,
    ]);

    const nov28 = (await getTransactionsFn({ data: { walletId: f.cash.id, dateFrom: `${f.year}-11-28T00:00:00+05:00`, dateTo: `${f.year}-11-28T23:59:59+05:00` } } as never)) as { data: unknown[] };
    expect(nov28.data).toHaveLength(1);
  });
});
