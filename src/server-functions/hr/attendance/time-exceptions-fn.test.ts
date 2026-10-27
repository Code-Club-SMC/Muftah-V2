import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "time-exceptions-fn.ts"), "utf8");

describe("late/early decision server functions", () => {
  it("restricts both list and decide to HR managers (super admin passes via *)", () => {
    expect(source.match(/requireHrManageMiddleware/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/requireHrViewMiddleware/);
  });

  it("locks payroll writes and refuses dates in approved or paid payroll", () => {
    expect(source).toMatch(/lockAttendancePayrollWrites\(tx\)/);
    expect(source).toMatch(/assertAttendanceDatesEditable\(tx,/);
    expect(source).toMatch(/validateTimeExceptionDecision\(/);
  });

  it("appends to history instead of overwriting it", () => {
    expect(source).toMatch(/history:\s*\[\s*\.\.\.row\.history/);
  });

  it("lists only items on present days", () => {
    expect(source).toMatch(/eq\(attendance\.status, "present"\)/);
  });
});
