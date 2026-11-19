import { describe, expect, it } from "vitest";
import {
  findMissingWorkingDays,
  findPayrollCycleGaps,
  payrollCycleForDate,
} from "./coverage";

const days = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = start; d <= end; ) {
    out.push(d);
    d = new Date(new Date(`${d}T12:00:00Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  return out;
};

describe("payroll cycle coverage", () => {
  it("maps dates to the 16th-to-15th payroll month", () => {
    expect(payrollCycleForDate("2026-10-01")).toMatchObject({
      cycleStart: "2026-09-16",
      cycleEnd: "2026-10-15",
      slipLabel: "October 2026",
    });
    expect(payrollCycleForDate("2026-12-16")).toMatchObject({
      cycleStart: "2026-12-16",
      cycleEnd: "2027-01-15",
    });
  });

  it("flags the missing first half and the last day of the month", () => {
    const [gap] = findPayrollCycleGaps({
      reportDates: days("2026-10-01", "2026-10-14"),
      recordedDates: [],
      today: "2026-10-24",
    });
    expect(gap.label).toBe("October 2026");
    expect(gap.missingDayCount).toBe(16);
    expect(gap.missingRanges).toEqual([
      { start: "2026-09-16", end: "2026-09-30" },
      { start: "2026-10-15", end: "2026-10-15" },
    ]);
  });

  it("treats dates with saved attendance as covered", () => {
    expect(
      findPayrollCycleGaps({
        reportDates: days("2026-10-01", "2026-10-15"),
        recordedDates: days("2026-09-16", "2026-09-30"),
        today: "2026-10-24",
      }),
    ).toEqual([]);
  });

  it("ignores today and future dates in a running month", () => {
    const [gap] = findPayrollCycleGaps({
      reportDates: days("2026-10-16", "2026-10-20"),
      recordedDates: [],
      today: "2026-10-24",
    });
    expect(gap.missingRanges).toEqual([
      { start: "2026-10-21", end: "2026-10-23" },
    ]);
  });
});

describe("missing working days", () => {
  // 2026-10-04 is a Sunday.
  const base = {
    fromDate: "2026-10-03",
    toDate: "2026-10-06",
    today: "2026-11-19",
  };

  it("lists working days with nothing recorded, skipping rest days", () => {
    expect(
      findMissingWorkingDays({
        ...base,
        employees: [{ id: "ali", joiningDate: "2026-01-01", restDays: [0] }],
        covered: new Map([["ali", new Set(["2026-10-05"])]]),
      }),
    ).toEqual([
      { employeeId: "ali", date: "2026-10-03" },
      { employeeId: "ali", date: "2026-10-06" },
    ]);
  });

  it("lists an employee missing from the whole report", () => {
    expect(
      findMissingWorkingDays({
        ...base,
        employees: [{ id: "sara", joiningDate: "2026-01-01", restDays: [0, 6] }],
        covered: new Map(),
      }),
    ).toEqual([
      { employeeId: "sara", date: "2026-10-05" },
      { employeeId: "sara", date: "2026-10-06" },
    ]);
  });

  it("skips dates before joining and today onwards", () => {
    expect(
      findMissingWorkingDays({
        ...base,
        today: "2026-10-06",
        employees: [{ id: "new", joiningDate: "2026-10-05", restDays: [0] }],
        covered: new Map(),
      }),
    ).toEqual([{ employeeId: "new", date: "2026-10-05" }]);
  });
});
