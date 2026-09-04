import { describe, expect, it } from "vitest";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
} from "./hr-validators";

function buildEmployeeInput() {
  return {
    firstName: "Jabir",
    lastName: "Rehman",
    employeeCode: "EMP-0001",
    designation: "HR",
    department: "Human Resources",
    joiningDate: "2026-07-01",
    status: "active" as const,
    employmentType: "full_time" as const,
    phone: "",
    cnic: "",
    address: "",
    bankName: "",
    bankAccountNumber: "",
    standardDutyHours: 8,
    basicSalary: "25000",
    isOrderBooker: false,
    isSalesman: false,
    restDays: [0],
    allowanceConfig: [],
    annualLeaveAllowance: 14,
    compensatoryHoursBalance: 0,
    basicSalaryDeductionPolicyOverrideEnabled: false,
    basicSalaryDeductionPolicyOverride: {
      absent: true,
      annualLeave: false,
      sickLeave: false,
      specialLeave: false,
      lateArrival: false,
      earlyLeaving: false,
      notEmployed: true,
    },
  };
}

describe("employee validator shift timing support", () => {
  it("accepts a shifts array with start and end times", () => {
    const parsed = createEmployeeSchema.parse({
      ...buildEmployeeInput(),
      shifts: [{ start: "08:00", end: "17:00" }],
    });

    expect(parsed.shifts).toEqual([{ start: "08:00", end: "17:00" }]);
  });

  it("accepts multiple shifts", () => {
    const parsed = createEmployeeSchema.parse({
      ...buildEmployeeInput(),
      shifts: [
        { start: "08:00", end: "12:00" },
        { start: "13:00", end: "17:00" },
      ],
    });

    expect(parsed.shifts).toHaveLength(2);
  });

  it("rejects malformed shift time values", () => {
    expect(() =>
      createEmployeeSchema.parse({
        ...buildEmployeeInput(),
        shifts: [{ start: "8am", end: "17:00" }],
      }),
    ).toThrow();
  });

  it("keeps shifts on employee updates", () => {
    const parsed = updateEmployeeSchema.parse({
      ...buildEmployeeInput(),
      id: "emp_123",
      shifts: [{ start: "21:00:00", end: "06:00:00" }],
    });

    expect(parsed.shifts).toEqual([{ start: "21:00:00", end: "06:00:00" }]);
  });
});
