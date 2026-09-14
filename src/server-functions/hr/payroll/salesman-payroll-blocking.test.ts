import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAYROLL_CORE_SOURCE = readFileSync(
  resolve("src/server-functions/hr/payroll/core.ts"),
  "utf8",
);

describe("payroll blocks missing attendance for salesmen", () => {
  it("does not bypass salesmen in shouldBlockMissingAttendance", () => {
    expect(PAYROLL_CORE_SOURCE).not.toContain("return !employee.isSalesman;");
    expect(PAYROLL_CORE_SOURCE).toContain("function shouldBlockMissingAttendance(");
    expect(PAYROLL_CORE_SOURCE).toContain("return true;");
  });
});
