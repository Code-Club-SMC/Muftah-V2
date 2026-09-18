import { describe, it, expect } from "vitest";
import {
  calculatePayslip,
  type EmployeeData,
  type AttendanceRecord,
} from "./payroll-calculator";

describe("Payroll Attendance Deduction Waivers & Adjustments Engine", () => {
  const baseEmployee: EmployeeData = {
    id: "emp-waiver-1",
    employeeCode: "EMP001",
    firstName: "Test",
    lastName: "Employee",
    designation: "Staff",
    cnic: null,
    bankName: null,
    bankAccountNumber: null,
    basicSalary: "29975",
    standardDutyHours: 9,
    restDays: [0], // Sunday
    allowanceConfig: [
      {
        id: "houseRent",
        name: "House Rent",
        amount: 11990,
        deductions: {
          absent: true,
          specialLeave: true,
          lateArrival: true,
          earlyLeaving: true,
          annualLeave: false,
          sickLeave: false,
        },
      },
      {
        id: "utilities",
        name: "Utilities",
        amount: 8993,
        deductions: {
          absent: true,
          specialLeave: true,
          lateArrival: true,
          earlyLeaving: false,
          annualLeave: false,
          sickLeave: false,
        },
      },
      {
        id: "conveyance",
        name: "Conveyance Allowance",
        amount: 8993,
        deductions: {
          absent: true,
          annualLeave: true,
          specialLeave: true,
          lateArrival: true,
          earlyLeaving: false,
          sickLeave: false,
        },
      },
      {
        id: "technical",
        name: "Technical Allowance",
        amount: 10000,
        deductions: {
          absent: false,
          annualLeave: false,
          specialLeave: false,
          lateArrival: false,
          earlyLeaving: false,
          sickLeave: false,
        },
      },
    ],
    basicSalaryDeductionPolicy: {
      absent: true,
      lateArrival: true,
      earlyLeaving: true,
      sickLeave: false,
      specialLeave: false,
      annualLeave: false,
      notEmployed: true,
    },
  };

  const payrollPeriod = {
    month: "2026-09-01",
    startDate: "2026-08-16",
    endDate: "2026-09-15",
  };

  // 26 working days (Mon-Sat, Aug 16 to Sep 15):
  // 1 absent, 1 special leave, 1 sick leave, 23 present (with 38.47 undertime hours)
  const buildRecords = (): AttendanceRecord[] => {
    const records: AttendanceRecord[] = [];
    let d = new Date(2026, 7, 16);
    let workingDay = 0;
    while (d <= new Date(2026, 8, 15)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${dayNum}`;
      if (d.getDay() !== 0) {
        workingDay++;
        if (workingDay === 1) {
          records.push({ date: dateStr, status: "absent", dutyHours: "0", overtimeHours: null, isNightShift: false });
        } else if (workingDay === 2) {
          records.push({ date: dateStr, status: "leave", leaveType: "special", isApprovedLeave: true, dutyHours: "0", overtimeHours: null, isNightShift: false });
        } else if (workingDay === 3) {
          records.push({ date: dateStr, status: "leave", leaveType: "sick", isApprovedLeave: true, dutyHours: "0", overtimeHours: null, isNightShift: false });
        } else if (workingDay === 4) {
          records.push({ date: dateStr, status: "present", dutyHours: String(9 - 8.47), isLate: true, overtimeHours: null, isNightShift: false });
        } else if (workingDay <= 7) {
          records.push({ date: dateStr, status: "present", dutyHours: "0", isLate: true, overtimeHours: null, isNightShift: false });
        } else {
          records.push({ date: dateStr, status: "present", dutyHours: "9", overtimeHours: null, isNightShift: false });
        }
      }
      d.setDate(d.getDate() + 1);
    }
    const shortRecords = records.filter(r => r.status === "present" && parseFloat(r.dutyHours || "9") < 9);
    const sumShort = shortRecords.reduce((s, r) => s + (9 - parseFloat(r.dutyHours || "9")), 0);
    shortRecords[0].dutyHours = String(parseFloat(shortRecords[0].dutyHours || "0") + (sumShort - 38.47));
    return records;
  };

  it("calculates baseline attendance deductions correctly before any waiver", () => {
    const records = buildRecords();
    const res = calculatePayslip(baseEmployee, records, payrollPeriod);

    expect(res.daysAbsent).toBe(1);
    expect(res.daysSpecialLeave).toBe(1);
    expect(res.daysSickLeave).toBe(1);
    expect(res.totalUndertimeHours).toBe(38.47);

    expect(res.deductionBreakdownByOccasion.absent).toBe(2306);
    expect(res.deductionBreakdownByOccasion.specialLeave).toBe(1153);
    expect(res.deductionBreakdownByOccasion.undertime).toBe(9855);
    expect(res.absentDeduction + res.leaveDeduction).toBe(13314);
    expect(res.netSalary).toBe(69951 - 13314);
  });

  it("waiveAll: true waives 100% of attendance deductions and pays full contract gross", () => {
    const records = buildRecords();
    const res = calculatePayslip(
      baseEmployee,
      records,
      payrollPeriod,
      undefined,
      undefined,
      undefined,
      { waiveAll: true },
    );

    expect(res.daysAbsent).toBe(1);
    expect(res.daysSpecialLeave).toBe(1);
    expect(res.totalUndertimeHours).toBe(38.47);

    expect(res.deductionBreakdownByOccasion.absent).toBe(0);
    expect(res.deductionBreakdownByOccasion.specialLeave).toBe(0);
    expect(res.deductionBreakdownByOccasion.undertime).toBe(0);
    expect(res.absentDeduction).toBe(0);
    expect(res.leaveDeduction).toBe(0);
    expect(res.totalDeductions).toBe(0);

    expect(res.componentDeductions.basicSalary).toBe(0);
    expect(res.componentDeductions.houseRent).toBe(0);
    expect(res.componentDeductions.utilities).toBe(0);
    expect(res.componentDeductions.conveyance).toBe(0);
    expect(res.adjustedBreakdown.basicSalary).toBe(29975);
    expect(res.adjustedBreakdown.houseRent).toBe(11990);

    expect(res.netSalary).toBe(69951);
  });

  it("waiveUndertime: true waives undertime while keeping Absent and Special Leave intact", () => {
    const records = buildRecords();
    const res = calculatePayslip(
      baseEmployee,
      records,
      payrollPeriod,
      undefined,
      undefined,
      undefined,
      { waiveUndertime: true },
    );

    expect(res.deductionBreakdownByOccasion.undertime).toBe(0);
    expect(res.deductionBreakdownByOccasion.absent).toBe(2306);
    expect(res.deductionBreakdownByOccasion.specialLeave).toBe(1153);

    expect(res.absentDeduction).toBe(2306);
    expect(res.leaveDeduction).toBe(1153);
    expect(res.totalDeductions).toBe(3459);

    const sumComponentDeductions = Object.values(res.componentDeductions).reduce((s, v) => s + v, 0);
    expect(sumComponentDeductions).toBe(3459);
    expect(res.netSalary).toBe(69951 - 3459);
  });

  it("waiveAbsent: true waives absent while keeping Undertime and Special Leave intact", () => {
    const records = buildRecords();
    const res = calculatePayslip(
      baseEmployee,
      records,
      payrollPeriod,
      undefined,
      undefined,
      undefined,
      { waiveAbsent: true },
    );

    expect(res.deductionBreakdownByOccasion.absent).toBe(0);
    expect(res.deductionBreakdownByOccasion.undertime).toBe(9855);
    expect(res.deductionBreakdownByOccasion.specialLeave).toBe(1153);

    // Total deduction = Undertime (9855) + Special (1153) = 11008
    expect(res.absentDeduction).toBe(9855);
    expect(res.leaveDeduction).toBe(1153);
    expect(res.totalDeductions).toBe(11008);

    const sumComponentDeductions = Object.values(res.componentDeductions).reduce((s, v) => s + v, 0);
    expect(sumComponentDeductions).toBe(11008);
    expect(res.netSalary).toBe(69951 - 11008);
  });

  it("customDeductions: overrides undertime to custom amount and scales components proportionally", () => {
    const records = buildRecords();
    const res = calculatePayslip(
      baseEmployee,
      records,
      payrollPeriod,
      undefined,
      undefined,
      undefined,
      {
        customDeductions: {
          undertime: 5000,
        },
      },
    );

    expect(res.deductionBreakdownByOccasion.undertime).toBe(5000);
    expect(res.deductionBreakdownByOccasion.absent).toBe(2306);
    expect(res.deductionBreakdownByOccasion.specialLeave).toBe(1153);

    const expectedTotal = 2306 + 1153 + 5000; // 8459
    expect(res.absentDeduction + res.leaveDeduction).toBe(expectedTotal);

    const sumComponentDeductions = Object.values(res.componentDeductions).reduce((s, v) => s + v, 0);
    expect(sumComponentDeductions).toBe(expectedTotal);
    expect(res.netSalary).toBe(69951 - expectedTotal);
  });
});
