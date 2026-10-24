import { describe, expect, it } from "vitest";
import { getDayIssues, type DayIssueInput } from "./day-issues";

// 2026-01-04 is a Sunday (default rest day).
const employee = {
  joiningDate: "2025-01-01",
  restDays: [0],
  shifts: [{ start: "09:00", end: "17:00" }],
  standardDutyHours: 8,
};

const present = {
  status: "present",
  checkIn: "09:00:00",
  checkOut: "17:00:00",
  dutyHours: "8.00",
  overtimeHours: "0",
  isLate: false,
  earlyDepartureStatus: "none",
};

const inOut = [
  { direction: "in" as const },
  { direction: "out" as const },
];

function issues(overrides: Partial<DayIssueInput>) {
  return getDayIssues({
    date: "2026-01-05",
    today: "2026-01-31",
    employee,
    record: null,
    punches: [],
    lockedPayroll: false,
    ...overrides,
  });
}

const kinds = (overrides: Partial<DayIssueInput>) =>
  issues(overrides).map((issue) => issue.kind);

describe("getDayIssues", () => {
  it("flags a past workday with no punches and no status", () => {
    expect(issues({})).toEqual([
      { kind: "no_punches", severity: "action", label: "No punches on workday" },
    ]);
  });

  it("does not flag rest days, today or future days without punches", () => {
    expect(kinds({ date: "2026-01-04" })).toEqual([]);
    expect(kinds({ date: "2026-01-31" })).toEqual([]);
    expect(kinds({ date: "2026-02-02" })).toEqual([]);
  });

  it("reports a full normal day as clean", () => {
    expect(kinds({ record: present, punches: inOut })).toEqual([]);
  });

  it("flags missing checkout on past days but not today", () => {
    const record = { ...present, checkOut: null, dutyHours: "0" };
    const punches = [{ direction: "in" as const }];
    expect(kinds({ record, punches })).toEqual(["missing_checkout"]);
    expect(kinds({ record, punches, date: "2026-01-31" })).toEqual([]);
  });

  it("flags a day that starts with an out punch as missing check-in", () => {
    expect(
      kinds({
        record: { ...present, checkIn: null, dutyHours: "0" },
        punches: [{ direction: "out" }],
      }),
    ).toEqual(["missing_checkin"]);
  });

  it("charges late only when the day ends up short", () => {
    const short = issues({
      record: { ...present, checkIn: "09:40:00", dutyHours: "7.33", isLate: true },
      punches: inOut,
    });
    expect(short.find((i) => i.kind === "late")).toMatchObject({
      severity: "deduction",
      label: "Late (40m)",
    });
    expect(short.find((i) => i.kind === "undertime")?.label).toBe(
      "Undertime (40m)",
    );

    const madeUp = issues({
      record: { ...present, checkIn: "09:40:00", isLate: true },
      punches: inOut,
    });
    expect(madeUp.map((i) => [i.kind, i.severity])).toEqual([["late", "info"]]);
  });

  it("counts banked cover toward the day and shows what is still short", () => {
    const record = { ...present, checkOut: "13:00:00", dutyHours: "4.00" };
    expect(
      issues({ record: { ...record, compensatoryHoursUsed: "4.00" }, punches: inOut }).map(
        (i) => [i.kind, i.label],
      ),
    ).toEqual([["bank_cover", "Covered from bank (4h)"]]);
    expect(
      issues({ record: { ...record, compensatoryHoursUsed: "3.00" }, punches: inOut }).map(
        (i) => i.label,
      ),
    ).toEqual(["Covered from bank (3h)", "Undertime (1h)"]);
  });

  it("asks HR to decide pending early departures", () => {
    expect(
      issues({
        record: {
          ...present,
          checkOut: "15:00:00",
          dutyHours: "6.00",
          earlyDepartureStatus: "pending",
        },
        punches: inOut,
      }).map((i) => [i.kind, i.severity, i.label]),
    ).toEqual([
      ["early_departure", "action", "Early departure (2h, pending)"],
      ["undertime", "deduction", "Undertime (2h)"],
    ]);
  });

  it("flags rest-day work and its pending overtime", () => {
    expect(
      kinds({
        date: "2026-01-04",
        record: { ...present, dutyHours: "4.00", overtimeHours: "4.00", overtimeStatus: "pending" },
        punches: inOut,
      }),
    ).toEqual(["rest_day_work", "overtime_pending"]);
  });

  it("shows approved and comp-off overtime as information", () => {
    expect(
      issues({
        record: {
          ...present,
          dutyHours: "10.00",
          overtimeHours: "2.00",
          overtimeStatus: "approved",
          overtimeCompensationMethod: "comp_off",
        },
        punches: inOut,
      }).map((i) => [i.kind, i.severity, i.label]),
    ).toEqual([["overtime_approved", "info", "Overtime approved (2h, comp-off)"]]);
  });

  it("flags punches recorded on leave and holiday days", () => {
    expect(
      kinds({
        record: { status: "leave", leaveType: "sick", leaveApprovalStatus: "approved", isApprovedLeave: true },
        punches: inOut,
      }),
    ).toEqual(["leave_punches"]);
    expect(kinds({ record: { status: "holiday" }, punches: inOut })).toEqual([
      "holiday_punches",
    ]);
  });

  it("separates pending, unpaid and short comp-off leave", () => {
    expect(
      kinds({ record: { status: "leave", leaveType: "sick", leaveApprovalStatus: "pending" } }),
    ).toEqual(["leave_pending"]);
    expect(
      kinds({
        record: { status: "leave", leaveType: "annual", leaveApprovalStatus: "approved", isApprovedLeave: false },
      }),
    ).toEqual(["unpaid_leave"]);
    expect(
      issues({
        record: {
          status: "leave",
          leaveType: "compensatory",
          leaveApprovalStatus: "approved",
          isApprovedLeave: true,
          compensatoryHoursUsed: "5.00",
        },
      }).map((i) => i.label),
    ).toEqual(["Comp-off short (3h uncovered)"]);
  });

  it("marks absent days as deductions", () => {
    expect(issues({ record: { status: "absent" } })).toEqual([
      { kind: "absent", severity: "deduction", label: "Absent (full day)" },
    ]);
  });

  it("marks locked payroll days and days before joining", () => {
    expect(kinds({ record: present, punches: inOut, lockedPayroll: true })).toEqual([
      "payroll_locked",
    ]);
    expect(
      kinds({ employee: { ...employee, joiningDate: "2026-01-10" } }),
    ).toEqual(["not_employed"]);
  });
});
