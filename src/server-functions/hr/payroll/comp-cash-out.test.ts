import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const CORE = read("src/server-functions/hr/payroll/core.ts");
const BANK = read("src/server-functions/hr/attendance/compensatory-bank-fn.ts");
const RECOMPUTE = read("src/lib/attendance/recompute-server.ts");

describe("comp-off cash-outs in payroll", () => {
  it("adds payable cash-outs to gross and net before the deficit carry-forward", () => {
    const cashOutAt = CORE.indexOf("payslipCalc.netSalary += cashOuts.amount;");
    const deficitAt = CORE.indexOf("const previousDeficit = await getPreviousDeficitForPeriod(");
    expect(cashOutAt).toBeGreaterThan(-1);
    expect(cashOutAt).toBeLessThan(deficitAt);
    expect(CORE).toContain("payslipCalc.grossSalary += cashOuts.amount;");
    expect(CORE).toContain("payslipCalc.calculationMeta.overtimeRatePerHour");
  });

  it("stores the payout on the payslip and links each cash-out exactly once", () => {
    expect(CORE).toContain("compCashOutAmount: cashOuts.amount.toFixed(2),");
    expect(CORE).toContain("paidInPayslipId: slip.id,");
    expect(CORE).toContain("isNull(compensatoryCashOuts.paidInPayslipId)");
    expect(CORE).toContain("Comp-off cash-outs changed during payroll generation");
  });

  it("unlinks cash-outs when a payslip is reversed so they pay again later", () => {
    const reverse = CORE.slice(
      CORE.indexOf("export async function reversePayslipSideEffects("),
      CORE.indexOf("async function getPreviousDeficitForPeriod("),
    );
    expect(reverse).toContain("update(compensatoryCashOuts)");
    expect(reverse).toContain("paidInPayslipId: null");
  });
});

describe("comp-off bank server rules", () => {
  it("takes hours from the balance when a cash-out is recorded and refunds on cancel", () => {
    expect(BANK).toContain('adjustCompensatoryReservation(tx, data.employeeId, "0", hours.toFixed(2))');
    expect(BANK).toContain('adjustCompensatoryReservation(tx, cashOut.employeeId, cashOut.hours, "0")');
  });

  it("settles the whole balance on final settlement", () => {
    expect(BANK).toContain('data.kind === "final_settlement" ? balance');
  });

  it("only covers short present days for standard punch employees, within the limit", () => {
    expect(BANK).toContain('row.status !== "present"');
    expect(BANK).toContain("employee.isSalesman || employee.isDriver || employee.isOrderBooker");
    expect(BANK).toContain("data.hours > limit + 0.001");
    expect(BANK).toContain("invalidateDeviceAttendanceChanges(tx, row.employeeId, [row.date])");
  });

  it("recomputation keeps cover capped to the new shortfall and refunds the rest", () => {
    expect(RECOMPUTE).toContain("compensatoryHoursUsed: keptCompUsed > 0 ? keptCompUsed.toFixed(2) : \"0\"");
    expect(RECOMPUTE).toContain("refundCompensatoryHours(tx, employeeId, previousCompUsed - keptCompUsed)");
    // Deleting a present row with no punches left must refund its cover too.
    const deleteAt = RECOMPUTE.indexOf(".delete(attendance)");
    expect(RECOMPUTE.lastIndexOf("refundCompensatoryHours(", deleteAt)).toBeGreaterThan(-1);
  });
});
