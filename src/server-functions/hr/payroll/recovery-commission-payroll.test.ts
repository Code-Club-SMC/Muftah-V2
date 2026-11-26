import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const core = readFileSync(resolve(__dirname, "core.ts"), "utf8");
const performance = readFileSync(resolve(__dirname, "sales-performance-fn.ts"), "utf8");

describe("payroll reads recovery commission", () => {
  it("collects ledger commission in both payslip generation and the preview", () => {
    expect(core.match(/collectPayslipCommission\(/g)?.length).toBe(2);
    expect(core.match(/ensureRecoveryCommissionSwitchover\(\)/g)?.length).toBe(2);
    expect(core).toContain("markPayslipCommissionPaid(tx,");
    expect(core).toContain("releasePayslipCommission(tx, payslipId)");
  });

  it("counts ledger commission in monthly sales performance", () => {
    expect(performance).toContain("commissionEarnings");
  });
});
