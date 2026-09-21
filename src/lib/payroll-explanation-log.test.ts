import { describe, it, expect } from "vitest";
import { calculatePayslip } from "./payroll-calculator";
import { EmployeeData } from "./payroll-calculator";
import { DEFAULT_BASIC_SALARY_DEDUCTION_POLICY } from "./types/hr-types";

describe("Payroll Explanation Log & Undertime Math", () => {
  const dummyEmployee: EmployeeData = {
    id: "emp_1",
    employeeCode: "E001",
    firstName: "Test",
    lastName: "User",
    designation: "Developer",
    basicSalary: "50000",
    standardDutyHours: 8,
    joinedAt: "2026-01-01",
    restDays: [0], // Sunday
    basicSalaryDeductionPolicy: DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
    allowanceConfig: []
  };

  const period = { month: "2026-02-01", startDate: "2026-02-01", endDate: "2026-02-28" };

  it("should accurately compute 0.02 undertime without losing precision and generate an explanation log", () => {
    // 28 days in Feb 2026. 4 Sundays (rest days). 24 working days.
    // Employee is present for 24 days.
    // On Feb 2nd, employee clocked 7.98 hours instead of 8.00 hours. (short by 0.02)
    // On Feb 3rd, employee is full day absent.
    // On Feb 4th, employee is on sick leave.
    
    const records = Array.from({ length: 24 }).map((_, i) => {
      const day = i + 1; // skip weekends manually if we want, but let's just force the specific dates
      const date = `2026-02-${day.toString().padStart(2, '0')}`;
      
      if (date === "2026-02-02") {
        return { date, status: "present", dutyHours: "7.98", isNightShift: false, isLate: true, earlyDepartureStatus: "none" };
      }
      if (date === "2026-02-03") {
        return { date, status: "absent", dutyHours: "0", isNightShift: false };
      }
      if (date === "2026-02-04") {
        return { date, status: "leave", leaveType: "sick", isApprovedLeave: true, dutyHours: "0", isNightShift: false };
      }
      if (date === "2026-02-05") {
        return { date, status: "present", dutyHours: "8", overtimeHours: "2.5", overtimeStatus: "approved", isNightShift: false };
      }
      
      return { date, status: "present", dutyHours: "8", isNightShift: false };
    }) as any[];

    const payslip = calculatePayslip(dummyEmployee, records, period);

    // 1. Math check: The undertime should be exactly 0.02
    expect(payslip.totalUndertimeHours).toBe(0.02);

    // 2. Overtime check: Should be exactly 2.5
    expect(payslip.totalOvertimeHours).toBe(2.5);

    // 3. Explanation Log check:
    expect(payslip.explanationLog).toBeDefined();
    expect(Array.isArray(payslip.explanationLog)).toBe(true);

    // We expect: Late Arrival for 0.02 hrs, Absent for 1 day, Sick Leave for 1 day, Overtime for 2.5 hrs.
    const undertimeLog = payslip.explanationLog.find(l => l.date === "2026-02-02");
    expect(undertimeLog).toMatchObject({
      type: "lateArrival", // Because isLate: true
      value: 0.02,
      unit: "hrs"
    });

    const absentLog = payslip.explanationLog.find(l => l.date === "2026-02-03");
    expect(absentLog).toMatchObject({
      type: "absent",
      value: 1,
      unit: "days"
    });

    const sickLog = payslip.explanationLog.find(l => l.date === "2026-02-04");
    expect(sickLog).toMatchObject({
      type: "sickLeave",
      value: 1,
      unit: "days"
    });

    const overtimeLog = payslip.explanationLog.find(l => l.type === "overtime");
    expect(overtimeLog).toMatchObject({
      date: "2026-02-05",
      value: 2.5,
      unit: "hrs"
    });
  });
});
