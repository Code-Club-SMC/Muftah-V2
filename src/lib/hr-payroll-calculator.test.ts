import { describe, it, expect } from "vitest";
import {
  sumApprovedOvertimeHours,
  calculateOvertimePay,
  calculatePayslip,
  type AttendanceRecord,
  type EmployeeData,
} from "./payroll-calculator";

const baseEmployee: EmployeeData = {
  id: "emp-1",
  employeeCode: "EMP-001",
  firstName: "Ali",
  lastName: "Raza",
  cnic: "12345",
  designation: "Operator",
  bankName: null,
  bankAccountNumber: null,
  basicSalary: "50000",
  allowanceConfig: [],
  standardDutyHours: 8,
  restDays: [0],
};

const presentRecord = (overtimeStatus: string): AttendanceRecord => ({
  date: "2026-07-01",
  status: "present",
  dutyHours: "10.00",
  overtimeHours: "2.00",
  isNightShift: false,
  overtimeStatus,
});

describe("Phase 7 — payroll overtime behavior", () => {
  it("only approved overtime hours count", () => {
    expect(
      sumApprovedOvertimeHours([
        presentRecord("pending"),
        presentRecord("approved"),
        presentRecord("rejected"),
      ]),
    ).toBe(2);
  });

  it("overtime pay formula is per-hour basic times hours", () => {
    const pay = calculateOvertimePay(50000, 8, 30, 2);
    expect(pay).toBe(417);
  });

  it("payslip overtime amount is zero while OT is pending", () => {
    const slip = calculatePayslip(
      baseEmployee,
      [presentRecord("pending")],
      { month: "2026-07-01", startDate: "2026-07-01", endDate: "2026-07-01" },
    );
    expect(slip.totalOvertimeHours).toBe(0);
    expect(slip.overtimeAmount).toBe(0);
  });

  it("payslip overtime amount is zero when OT is rejected", () => {
    const slip = calculatePayslip(
      baseEmployee,
      [presentRecord("rejected")],
      { month: "2026-07-01", startDate: "2026-07-01", endDate: "2026-07-01" },
    );
    expect(slip.totalOvertimeHours).toBe(0);
    expect(slip.overtimeAmount).toBe(0);
  });

  it("payslip pays approved overtime", () => {
    const slip = calculatePayslip(
      baseEmployee,
      [presentRecord("approved")],
      { month: "2026-07-01", startDate: "2026-07-01", endDate: "2026-07-01" },
    );
    expect(slip.totalOvertimeHours).toBe(2);
    expect(slip.overtimeAmount).toBeGreaterThan(0);
  });
});
