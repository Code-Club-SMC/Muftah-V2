import { describe, it, expect } from "vitest";
import {
  calculatePayslip,
  type AttendanceRecord,
  type EmployeeData,
} from "./payroll-calculator";
import type { AllowanceConfig } from "./types/hr-types";

describe("Generic Allowance Deductions Engine", () => {
  const customAllowances: AllowanceConfig[] = [
    {
      id: "houseRent",
      name: "House Rent",
      amount: 11990,
      deductions: {
        absent: true,
        annualLeave: false,
        sickLeave: false,
        specialLeave: true,
        lateArrival: true,
        earlyLeaving: true,
      },
    },
    {
      id: "utilities",
      name: "Utilities",
      amount: 8993,
      deductions: {
        absent: true,
        annualLeave: false,
        sickLeave: false,
        specialLeave: true,
        lateArrival: true,
        earlyLeaving: false,
      },
    },
    {
      id: "conveyance",
      name: "Conveyance Allowance",
      amount: 8993,
      deductions: {
        absent: true,
        annualLeave: true,
        sickLeave: false,
        specialLeave: true,
        lateArrival: true,
        earlyLeaving: false,
      },
    },
    {
      id: "custom_technical",
      name: "Technical Allowance",
      amount: 10000,
      deductions: {
        absent: true,
        annualLeave: false,
        sickLeave: false,
        specialLeave: false,
        lateArrival: false,
        earlyLeaving: false,
      },
    },
    {
      id: "custom_hazard",
      name: "Hazard Pay",
      amount: 5000,
      deductions: {
        absent: false,
        annualLeave: false,
        sickLeave: false,
        specialLeave: false,
        lateArrival: false,
        earlyLeaving: false,
      },
    },
  ];

  const testEmployee: EmployeeData = {
    id: "emp-dynamic-1",
    employeeCode: "EMP-DYN-01",
    firstName: "Zahid",
    lastName: "Khan",
    cnic: "42101-1234567-1",
    designation: "Senior Engineer",
    bankName: null,
    bankAccountNumber: null,
    basicSalary: "29975",
    standardDutyHours: 9,
    restDays: [0], // Sunday only rest day -> 6 days/week
    allowanceConfig: customAllowances,
  };

  it("correctly identifies non-deductible fixed components dynamically", () => {
    const slip = calculatePayslip(
      testEmployee,
      [],
      { month: "2026-08-01", startDate: "2026-08-16", endDate: "2026-09-15" },
    );

    expect(slip.fixedComponents["basicSalary"]).toBe(false);
    expect(slip.fixedComponents["houseRent"]).toBe(false);
    expect(slip.fixedComponents["utilities"]).toBe(false);
    expect(slip.fixedComponents["conveyance"]).toBe(false);
    expect(slip.fixedComponents["custom_technical"]).toBe(false);
    expect(slip.fixedComponents["custom_hazard"]).toBe(true); // No deductions active
    expect(slip.allowanceNames["custom_technical"]).toBe("Technical Allowance");
    expect(slip.allowanceNames["custom_hazard"]).toBe("Hazard Pay");
  });

  it("deducts Basic + all configured allowances on Absent day", () => {
    const records: AttendanceRecord[] = [
      {
        date: "2026-08-17",
        status: "absent",
        dutyHours: null,
        overtimeHours: null,
        isNightShift: false,
      },
    ];

    const slip = calculatePayslip(
      testEmployee,
      records,
      { month: "2026-08-01", startDate: "2026-08-16", endDate: "2026-09-15" },
    );

    // Total working days in cycle: 26 days (excluding 5 Sundays)
    const workingDays = slip.totalWorkingDays;
    expect(workingDays).toBe(26);

    expect(slip.componentDeductions["basicSalary"]).toBe(Math.round(29975 / 26));
    expect(slip.componentDeductions["houseRent"]).toBe(Math.round(11990 / 26));
    expect(slip.componentDeductions["utilities"]).toBe(Math.round(8993 / 26));
    expect(slip.componentDeductions["conveyance"]).toBe(Math.round(8993 / 26));
    expect(slip.componentDeductions["custom_technical"]).toBe(Math.round(10000 / 26));
    expect(slip.componentDeductions["custom_hazard"]).toBe(0);

    // Adjusted breakdown equals standard minus deducted
    expect(slip.adjustedBreakdown["houseRent"]).toBe(11990 - slip.componentDeductions["houseRent"]);
    expect(slip.adjustedBreakdown["custom_hazard"]).toBe(5000);

    // Absent deduction breakdown
    expect(slip.deductionBreakdownByOccasion.absent).toBe(slip.absentDeduction);
  });

  it("deducts configured allowances on Special Leave while keeping Basic Salary intact", () => {
    const records: AttendanceRecord[] = [
      {
        date: "2026-08-18",
        status: "leave",
        leaveType: "special",
        isApprovedLeave: true,
        dutyHours: null,
        overtimeHours: null,
        isNightShift: false,
      },
    ];

    const slip = calculatePayslip(
      testEmployee,
      records,
      { month: "2026-08-01", startDate: "2026-08-16", endDate: "2026-09-15" },
    );

    // Basic salary is paid on special leave
    expect(slip.componentDeductions["basicSalary"]).toBe(0);
    // House Rent, Utilities, Conveyance are deducted on special leave
    expect(slip.componentDeductions["houseRent"]).toBe(Math.round(11990 / 26));
    expect(slip.componentDeductions["utilities"]).toBe(Math.round(8993 / 26));
    expect(slip.componentDeductions["conveyance"]).toBe(Math.round(8993 / 26));
    // Technical is NOT deducted on special leave
    expect(slip.componentDeductions["custom_technical"]).toBe(0);

    expect(slip.deductionBreakdownByOccasion.specialLeave).toBe(slip.leaveDeduction);
    expect(slip.leaveDeduction).toBeGreaterThan(0);
  });

  it("deducts Conveyance on Approved Annual Leave per configured rule", () => {
    const records: AttendanceRecord[] = [
      {
        date: "2026-08-19",
        status: "leave",
        leaveType: "annual",
        isApprovedLeave: true,
        dutyHours: null,
        overtimeHours: null,
        isNightShift: false,
      },
    ];

    const slip = calculatePayslip(
      testEmployee,
      records,
      { month: "2026-08-01", startDate: "2026-08-16", endDate: "2026-09-15" },
    );

    // Conveyance is deducted on annual leave
    expect(slip.componentDeductions["conveyance"]).toBe(Math.round(8993 / 26));
    // Basic and other allowances without annualLeave rule are NOT deducted
    expect(slip.componentDeductions["basicSalary"]).toBe(0);
    expect(slip.componentDeductions["houseRent"]).toBe(0);
    expect(slip.deductionBreakdownByOccasion.annualLeave).toBe(Math.round(8993 / 26));
  });

  it("deducts Basic AND configured allowances proportionally on Undertime / Late Arrival", () => {
    const records: AttendanceRecord[] = [
      {
        date: "2026-08-20",
        status: "present",
        dutyHours: "5.00", // 4 hours undertime out of 9 standard hours
        overtimeHours: null,
        isNightShift: false,
        isLate: true,
      },
    ];

    const slip = calculatePayslip(
      testEmployee,
      records,
      { month: "2026-08-01", startDate: "2026-08-16", endDate: "2026-09-15" },
    );

    expect(slip.totalUndertimeHours).toBe(4);

    const perHourBasic = 29975 / (26 * 9);
    const expectedBasicUndertime = Math.round(perHourBasic * 4);
    expect(slip.componentDeductions["basicSalary"]).toBe(expectedBasicUndertime);

    // House Rent, Utilities, Conveyance have lateArrival: true
    const perHourHouse = 11990 / (26 * 9);
    expect(slip.componentDeductions["houseRent"]).toBe(Math.round(perHourHouse * 4));

    const perHourUtil = 8993 / (26 * 9);
    expect(slip.componentDeductions["utilities"]).toBe(Math.round(perHourUtil * 4));

    // Technical has lateArrival: false -> 0 deduction
    expect(slip.componentDeductions["custom_technical"]).toBe(0);

    expect(slip.deductionBreakdownByOccasion.undertime).toBe(slip.absentDeduction);
  });

  it("strictly reconciles: sum(componentDeductions) == sum(deductionBreakdownByOccasion) == totalAttendanceDeductions", () => {
    // Multi-scenario month: 1 absent, 1 special leave, 1 sick leave, 1 annual leave, 1 undertime day
    const records: AttendanceRecord[] = [
      { date: "2026-08-17", status: "absent", dutyHours: null, overtimeHours: null, isNightShift: false },
      { date: "2026-08-18", status: "leave", leaveType: "special", isApprovedLeave: true, dutyHours: null, overtimeHours: null, isNightShift: false },
      { date: "2026-08-19", status: "leave", leaveType: "sick", isApprovedLeave: true, dutyHours: null, overtimeHours: null, isNightShift: false },
      { date: "2026-08-20", status: "leave", leaveType: "annual", isApprovedLeave: true, dutyHours: null, overtimeHours: null, isNightShift: false },
      { date: "2026-08-21", status: "present", dutyHours: "6.00", overtimeHours: null, isNightShift: false, isLate: true }, // 3 hrs undertime
    ];

    const slip = calculatePayslip(
      testEmployee,
      records,
      { month: "2026-08-01", startDate: "2026-08-16", endDate: "2026-09-15" },
    );

    const totalAttendanceDeduction =
      slip.absentDeduction + slip.leaveDeduction + slip.notEmployedDeduction;

    const sumComponentDeductions = Object.values(slip.componentDeductions).reduce(
      (sum, val) => sum + val,
      0,
    );

    const sumOccasionDeductions = Object.values(slip.deductionBreakdownByOccasion).reduce(
      (sum, val) => sum + val,
      0,
    );

    // Sum of components matches total attendance deduction within rounding margin (±2 PKR due to integer rounding per component)
    expect(Math.abs(sumComponentDeductions - totalAttendanceDeduction)).toBeLessThanOrEqual(2);
    expect(Math.abs(sumOccasionDeductions - totalAttendanceDeduction)).toBeLessThanOrEqual(2);

    // Net salary is exactly gross minus total deductions
    expect(slip.netSalary).toBe(slip.grossSalary - slip.totalDeductions);
  });
});
