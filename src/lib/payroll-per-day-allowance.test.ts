import { describe, expect, it } from "vitest";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import { calculatePayslip, type AttendanceRecord, type EmployeeData } from "./payroll-calculator";
import { estimateMonthlyAllowance, STANDARD_ALLOWANCES, type AllowanceConfig } from "./types/hr-types";
import { createEmployeeSchema } from "./validators/hr-validators";

// 16 Oct to 15 Nov 2026 has 26 Monday-Saturday working days.
const period = { month: "2026-11-01", startDate: "2026-10-16", endDate: "2026-11-15" };
const fuelRule = STANDARD_ALLOWANCES.find((a) => a.id === "fuel")!;
const fuel = (amount: number, payBasis?: AllowanceConfig["payBasis"]): AllowanceConfig => ({ ...fuelRule, amount, payBasis });

function payslip(config: AllowanceConfig[], first: Partial<AttendanceRecord>[] = [], extra: Partial<EmployeeData> = {}, cutoff?: string, adjustments?: any) {
  const days = eachDayOfInterval({ start: parseISO(period.startDate), end: parseISO(period.endDate) }).filter((d) => d.getDay() !== 0);
  const records = days.map((d, i): AttendanceRecord => ({
    date: format(d, "yyyy-MM-dd"), status: "present", dutyHours: "8", overtimeHours: null, isNightShift: false, ...first[i],
  }));
  return calculatePayslip({
    id: "1", employeeCode: "1", firstName: "A", lastName: "B", cnic: null, designation: "x", bankName: null, bankAccountNumber: null,
    basicSalary: "26000", standardDutyHours: 8, restDays: [0], allowanceConfig: config, ...extra,
  }, records, period, undefined, {}, cutoff, adjustments);
}
const absent = { status: "absent" as const, dutyHours: null };
const leave = (leaveType: string) => ({ status: "leave" as const, leaveType, isApprovedLeave: true, dutyHours: null });

describe("per-day allowances", () => {
  it.each([[750, 19500], [500, 13000]])("pays %i a day for 26 days present as %i", (rate, total) => {
    const slip = payslip([fuel(rate, "perDay")]);
    expect(slip.allowanceBreakdown.fuel).toBe(total);
    expect(slip.grossSalary).toBe(26000 + total);
    expect(slip.netSalary).toBe(26000 + total);
    expect(slip.allowanceNames.fuel).toContain(`${rate} × 26 days present`);
  });

  it("pays nothing for absent and every kind of leave day, without deducting twice", () => {
    const slip = payslip([fuel(500, "perDay")], [absent, absent, leave("annual"), leave("sick"), leave("special")]);
    expect(slip.daysPresent).toBe(21);
    expect(slip.allowanceBreakdown.fuel).toBe(10500);
    expect(slip.componentDeductions.fuel).toBe(0);
    // Only the two absent days' basic is cut: 2 × 1000.
    expect(slip.netSalary).toBe(26000 + 10500 - 2000);
  });

  it("does not prorate again for days before joining, and pays a short day in full", () => {
    const joined = payslip([fuel(500, "perDay")], [], { joiningDate: "2026-11-02" });
    expect(joined.allowanceBreakdown.fuel).toBe(500 * joined.daysPresent);
    expect(joined.componentDeductions.fuel).toBe(0);
    expect(payslip([fuel(500, "perDay")], [{ dutyHours: "4", isLate: true }]).allowanceBreakdown.fuel).toBe(13000);
  });

  it("pays only up to an early cutoff, and not for waived absent days", () => {
    const cut = payslip([fuel(500, "perDay")], [], {}, "2026-10-31");
    expect(cut.daysPresent).toBe(14);
    expect(cut.allowanceBreakdown.fuel).toBe(7000);
    expect(payslip([fuel(500, "perDay")], [absent], {}, undefined, { waiveAll: true }).allowanceBreakdown.fuel).toBe(12500);
  });

  it("leaves monthly allowances exactly as before", () => {
    for (const basis of [undefined, "monthly"] as const) {
      const slip = payslip([fuel(13000, basis)], [absent]);
      expect(slip.allowanceBreakdown.fuel).toBe(13000);
      expect(slip.componentDeductions.fuel).toBe(500);
      expect(slip.allowanceNames.fuel).toBe("Fuel Allowance");
    }
  });

  it("keeps the pay basis when an employee is saved, and estimates with 26 days", () => {
    const saved = createEmployeeSchema.shape.allowanceConfig.parse([fuel(750, "perDay")]);
    expect(saved[0].payBasis).toBe("perDay");
    expect(estimateMonthlyAllowance(saved[0])).toBe(19500);
    expect(estimateMonthlyAllowance(fuel(750))).toBe(750);
  });
});
