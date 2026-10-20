import { describe, expect, it } from "vitest";
import { calculateAbsentDeductions, calculatePayslip, calculateOvertimePay, type AttendanceRecord, type EmployeeData } from "./payroll-calculator";
import { DEFAULT_BASIC_SALARY_DEDUCTION_POLICY, type AllowanceConfig } from "./types/hr-types";

const allowance = (id: string, amount: number, specialLeave: boolean, annualLeave = false): AllowanceConfig => ({
  id, name: id, amount,
  deductions: { absent: id !== "special", annualLeave, specialLeave, sickLeave: false, lateArrival: false, earlyLeaving: false },
});
const employee: EmployeeData = {
  id: "emp", employeeCode: "E1", firstName: "Policy", lastName: "Fixture", designation: "Staff",
  cnic: null, bankName: null, bankAccountNumber: null, basicSalary: "26000", standardDutyHours: 8, restDays: [0],
  allowanceConfig: [allowance("houseRent", 5200, true), allowance("utilities", 2600, true), allowance("conveyance", 2600, true, true), allowance("mobile", 1300, true), allowance("bike", 1300, true), allowance("technical", 2600, false), allowance("special", 1300, false)],
};
const cycle = { month: "2026-10-01", startDate: "2026-09-16", endDate: "2026-10-15" };
const record = (overrides: Partial<AttendanceRecord>): AttendanceRecord => ({ date: "2026-09-16", status: "present", dutyHours: "8.00", overtimeHours: "0", isNightShift: false, ...overrides });
const slip = (records: AttendanceRecord[], policy = DEFAULT_BASIC_SALARY_DEDUCTION_POLICY) => calculatePayslip({ ...employee, basicSalaryDeductionPolicy: policy }, records, cycle);

describe("approved payroll policies and decimal boundaries", () => {
  it("marks a selective annual waiver in the explanation while retaining its original amount", () => {
    const result = calculateAbsentDeductions(employee, [record({ status: "leave", leaveType: "annual", isApprovedLeave: true, dutyHours: "0" })], 26, { waiveAnnualLeave: true });
    expect(result.componentDeductions.conveyance).toBe(0);
    expect(result.unadjustedOccasionDeductions.annualLeave).toBe(100);
    expect(result.explanationLog.find(entry => entry.type === "annualLeave")?.isWaived).toBe(true);
  });
  it("P1 preserves paid annual basic while unpaid annual uses the enabled basic policy", () => {
    const policy = { ...DEFAULT_BASIC_SALARY_DEDUCTION_POLICY, annualLeave: true };
    const paid = slip([record({ status: "leave", leaveType: "annual", isApprovedLeave: true, dutyHours: "0" })], policy);
    expect(paid.totalWorkingDays).toBe(26);
    expect(paid.componentDeductions.basicSalary).toBe(0);
    expect(paid.componentDeductions.conveyance).toBe(100);
    expect(paid.deductionBreakdownByOccasion.annualLeave).toBe(100);
    expect(paid.netSalary).toBe(42800);
    const unpaid = slip([record({ status: "leave", leaveType: "annual", isApprovedLeave: false, dutyHours: "0" })], policy);
    expect(unpaid.componentDeductions.basicSalary).toBe(1000);
    expect(unpaid.totalDeductions).toBe(1100);
    expect(unpaid.netSalary).toBe(41800);
  });

  it.each([["4", 4, 500, 42400], ["8", 0, 0, 42900]] as const)("P3 credits only %s approved comp hours", (hours, short, deduction, net) => {
    const result = slip([record({ status: "leave", leaveType: "compensatory", isApprovedLeave: true, dutyHours: "0", compensatoryHoursUsed: hours })]);
    expect(result.totalUndertimeHours).toBe(short);
    expect(result.componentDeductions.basicSalary).toBe(deduction);
    expect(result.deductionBreakdownByOccasion.undertime).toBe(deduction);
    expect(result.totalDeductions).toBe(deduction);
    expect(result.netSalary).toBe(net);
  });

  it("rounds the stored 7.98-hour boundary to PKR 3 in components, occasions and net", () => {
    const result = slip([record({ dutyHours: "7.98" })]);
    expect(result.totalUndertimeHours).toBe(0.02);
    expect(result.componentDeductions.basicSalary).toBe(3);
    expect(result.deductionBreakdownByOccasion.undertime).toBe(3);
    expect(result.totalDeductions).toBe(3);
    expect(result.netSalary).toBe(42897);
  });

  it("accumulates small deductions before whole-rupee rounding", () => {
    const result = slip([record({ dutyHours: "7.98" }), record({ date: "2026-09-17", dutyHours: "7.98" }), record({ date: "2026-09-18", dutyHours: "7.98" })]);
    expect(result.totalUndertimeHours).toBe(0.06);
    expect(result.componentDeductions.basicSalary).toBe(8);
    expect(result.deductionBreakdownByOccasion.undertime).toBe(8);
    expect(result.totalDeductions).toBe(8);
    expect(result.netSalary).toBe(42892);
  });

  it.each([[4.02, 1, 503], [1.16, 1.5, 218], [2.01, 2, 503]])("rounds overtime half rupees upward for %s hours at %s", (hours, multiplier, expected) => {
    expect(calculateOvertimePay(26000, 8, 26, hours, multiplier)).toBe(expected);
  });

  it("reconciles leave-only component rounding with occasion and total deductions", () => {
    const result = calculatePayslip({ ...employee, allowanceConfig: [allowance("one", 65, false, true), allowance("two", 65, false, true)] }, [record({ status: "leave", leaveType: "annual", isApprovedLeave: true, dutyHours: "0" })], cycle);
    expect(result.componentDeductions).toMatchObject({ basicSalary: 0, one: 3, two: 3 });
    expect(result.deductionBreakdownByOccasion.annualLeave).toBe(6);
    expect(result.totalDeductions).toBe(6);
    expect(result.netSalary).toBe(26124);
  });

  it("rounds an exact accumulated half rupee after thirteen fractional daily deductions", () => {
    const records = Array.from({ length: 13 }, (_, index) => record({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, status: "absent", dutyHours: "0" }));
    const result = calculateAbsentDeductions({ ...employee, basicSalary: "26625", allowanceConfig: [], restDays: [] }, records, 26);
    expect(result.componentDeductions.basicSalary).toBe(13313);
    expect(result.deductionBreakdownByOccasion.absent).toBe(13313);
    expect(result.absentDeduction).toBe(13313);
  });

  it("matches an independent integer-rational oracle across fractional daily rates", () => {
    for (const basic of [1, 3, 15, 45, 26625, 26000]) {
      for (const divisor of [3, 6, 26, 45]) {
        for (const count of [1, 2, 3, 7, 13, 15, 26].filter(value => value <= divisor)) {
          const numerator = BigInt(basic) * BigInt(count);
          const expected = Number((2n * numerator + BigInt(divisor)) / (2n * BigInt(divisor)));
          const records = Array.from({ length: count }, (_, index) => record({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, status: "absent", dutyHours: "0" }));
          const result = calculateAbsentDeductions({ ...employee, basicSalary: String(basic), allowanceConfig: [], restDays: [] }, records, divisor);
          expect(result.componentDeductions.basicSalary, `${basic}/${divisor} × ${count}`).toBe(expected);
          expect(result.absentDeduction).toBe(expected);
          expect(result.deductionBreakdownByOccasion.absent).toBe(expected);
        }
      }
    }
  });
});
