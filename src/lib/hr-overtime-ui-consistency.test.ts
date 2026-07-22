import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SALARY_CALCULATOR_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/components/hr/payroll/salary-calculator-form.tsx",
  ),
  "utf8",
);

describe("hr overtime UI consistency", () => {
  it("keeps the overtime warning aligned with the documented default multiplier", () => {
    expect(SALARY_CALCULATOR_SOURCE).toContain(
      "Standard is 1.0x of hourly basic rate.",
    );
    expect(SALARY_CALCULATOR_SOURCE).toContain(
      "overtimeMultiplier !== 1.0",
    );
    expect(SALARY_CALCULATOR_SOURCE).toContain(
      "standard is 1.0×",
    );
  });
});
