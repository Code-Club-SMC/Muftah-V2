import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DAILY_FN_SOURCE = readFileSync(
  resolve("src/server-functions/hr/attendance/get-daily-attendance-fn.ts"),
  "utf8",
);

describe("getDailyAttendanceFn includes salesmen", () => {
  it("does not exclude salesmen from the employee query", () => {
    expect(DAILY_FN_SOURCE).not.toContain("eq(employees.isSalesman, false)");
  });

  it("filters punches only for standard punch-driven employees", () => {
    expect(DAILY_FN_SOURCE).toContain("!employee.isOrderBooker && !employee.isSalesman");
  });

  it("attaches salesman activity summaries for the date", () => {
    expect(DAILY_FN_SOURCE).toContain("salesmanActivity");
  });
});
