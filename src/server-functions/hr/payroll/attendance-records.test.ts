import { describe, expect, it } from "vitest";
import { toPayrollAttendanceRecord } from "./attendance-records";

const base = {
  date: "2026-10-01", status: "present", dutyHours: "6.00", overtimeHours: "0", isNightShift: false,
  isApprovedLeave: false, leaveType: null, overtimeStatus: "pending", overtimeCompensationMethod: "payout",
  compensatoryHoursUsed: "0", isLate: false, earlyDepartureStatus: "pending",
} as const;

describe("toPayrollAttendanceRecord", () => {
  it("maps items with the decider's name", () => {
    const record = toPayrollAttendanceRecord({
      ...base,
      timeExceptions: [
        { kind: "early", minutes: 120, status: "approved_official", decidedByUser: { name: "Usman" } },
      ],
    } as never);
    expect(record.timeExceptions).toEqual([
      { kind: "early", minutes: 120, status: "approved_official", decidedByName: "Usman" },
    ]);
  });

  it("leaves items undefined when the row was loaded without them", () => {
    expect(toPayrollAttendanceRecord(base as never).timeExceptions).toBeUndefined();
  });
});
