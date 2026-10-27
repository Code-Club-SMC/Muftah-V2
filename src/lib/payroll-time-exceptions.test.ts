import { describe, expect, it } from "vitest";
import { calculatePayslip, type AttendanceRecord, type EmployeeData } from "./payroll-calculator";
import { DEFAULT_BASIC_SALARY_DEDUCTION_POLICY } from "./types/hr-types";
import type { PayrollTimeException } from "./attendance/time-exceptions";

// 26000 basic, 26 working days, 8h shift => Rs 125 per hour of basic.
const employee: EmployeeData = {
  id: "emp", employeeCode: "E1", firstName: "Ali", lastName: "Khan", designation: "Staff",
  cnic: null, bankName: null, bankAccountNumber: null, basicSalary: "26000", standardDutyHours: 8, restDays: [0],
  allowanceConfig: [],
  basicSalaryDeductionPolicy: DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
};
const cycle = { month: "2026-10-01", startDate: "2026-09-16", endDate: "2026-10-15" };
const day = (dutyHours: string, timeExceptions?: PayrollTimeException[]): AttendanceRecord => ({
  date: "2026-09-16", status: "present", dutyHours, overtimeHours: "0", isNightShift: false, timeExceptions,
});
const slip = (record: AttendanceRecord) => calculatePayslip(employee, [record], cycle);

describe("late/early approvals in payroll", () => {
  it("does not cut a pending early departure and says so", () => {
    const result = slip(day("6.00", [{ kind: "early", minutes: 120, status: "pending" }]));
    expect(result.totalDeductions).toBe(0);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({
      type: "earlyLeaving",
      description: "Early departure 2h — Not reviewed — no deduction",
      isWaived: true,
    }));
  });

  it("does not cut grace minutes", () => {
    const result = slip(day("7.83", [{ kind: "late", minutes: 10, status: "grace" }]));
    expect(result.totalDeductions).toBe(0);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({
      description: "Late arrival 10 min — grace applied — no deduction",
    }));
  });

  it("does not cut company work", () => {
    const result = slip(day("6.00", [{ kind: "early", minutes: 120, status: "approved_official", decidedByName: "Usman" }]));
    expect(result.totalDeductions).toBe(0);
  });

  it("cuts only the rejected item on a day with two items", () => {
    // 30 min late rejected + 2h early company work => only 0.5h cut = Rs 63 (62.5 rounded)
    const result = slip(day("5.50", [
      { kind: "late", minutes: 30, status: "rejected", decidedByName: "Usman" },
      { kind: "early", minutes: 120, status: "approved_official", decidedByName: "Usman" },
    ]));
    expect(result.deductionBreakdownByOccasion.undertime).toBe(63);
    expect(result.totalUndertimeHours).toBe(0.5);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({
      description: "Late arrival 30 min — Rejected by Usman",
      isWaived: false,
    }));
  });

  it("still cuts short time that is neither late nor early", () => {
    // 30 min late excused, plus 1h long break => 1h cut = Rs 125
    const result = slip(day("6.50", [{ kind: "late", minutes: 30, status: "approved_excused" }]));
    expect(result.deductionBreakdownByOccasion.undertime).toBe(125);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({ type: "undertime", value: 1 }));
  });

  it("keeps the old rule for rows without items", () => {
    const result = slip(day("7.00"));
    expect(result.deductionBreakdownByOccasion.undertime).toBe(125);
  });

  it("lets the month-level waiver cancel a rejected cut", () => {
    const result = calculatePayslip(
      employee,
      [day("7.00", [{ kind: "late", minutes: 60, status: "rejected" }])],
      cycle,
      undefined,
      undefined,
      undefined,
      { waiveUndertime: true },
    );
    expect(result.deductionBreakdownByOccasion.undertime).toBe(0);
  });
});
