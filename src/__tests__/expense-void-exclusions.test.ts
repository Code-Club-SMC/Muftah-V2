import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");
const occurrences = (path: string, needle: string) => source(path).split(needle).length - 1;

describe("voided expenses stay out of money totals", () => {
  it.each([
    ["src/server-functions/reports/profit-loss/company-reporting-core.ts", 2],
    ["src/server-functions/dashboard/get-dashboard-fn.ts", 2],
    ["src/server-functions/reports/expenses-report-fn.ts", 1],
    ["src/server-functions/finance-fn.ts", 1],
  ])("%s filters voided expenses %i time(s)", (path, times) => {
    expect(occurrences(path, "isNull(expenses.voidedAt)")).toBe(times);
  });

  it("every sum over expense amounts in those files leaves voided expenses out", () => {
    for (const path of [
      "src/server-functions/dashboard/get-dashboard-fn.ts",
      "src/server-functions/finance-fn.ts",
    ]) {
      expect(occurrences(path, "sum(${expenses.amount})")).toBeLessThanOrEqual(occurrences(path, "isNull(expenses.voidedAt)"));
    }
  });

  it("deleting a supplier purchase never removes a hand-recorded expense", () => {
    expect(source("src/server-functions/suppliers/delete-purchase-record-fn.ts")).toContain('eq(expenses.origin, "system")');
  });
});
