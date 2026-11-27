import { describe, expect, it } from "vitest";
import { buildShiftPunches, bulkResultMessage, datesBetween, isRealDate, planBulkAttendance } from "./bulk-mark";

const employee = { id: "e", joiningDate: "2026-01-01", restDays: [5], shifts: [{ start: "07:30", end: "13:00" }, { start: "14:00", end: "16:30" }], standardDutyHours: 8 };
const plan = (extra: Partial<Parameters<typeof planBulkAttendance>[0]> = {}) => planBulkAttendance({
  status: "present", conflictStrategy: "skip", dates: ["2026-11-25"], employees: [employee], records: [], punches: [], tripDays: new Set(), now: new Date("2026-11-25T16:30:00+05:00"), ...extra,
});

describe("bulk mark plan", () => {
  it("waits for today's last shift to finish before recording it", () => {
    expect(plan({ now: new Date("2026-11-25T16:29:59+05:00") }).summary).toMatchObject({ created: 0, skippedFuture: 1 });
    expect(plan().summary).toMatchObject({ created: 1, skippedFuture: 0 });
  });

  it("uses the Pakistan date, not the server's, for today", () => {
    // 01:00 in Pakistan on the 26th is still the 25th in UTC.
    const now = new Date("2026-11-26T01:00:00+05:00");
    expect(plan({ now, status: "absent", dates: ["2026-11-26", "2026-11-28"] }).summary).toMatchObject({ created: 1, skippedFuture: 1 });
  });

  it("marks field staff present today without waiting for a shift", () => {
    const { writes, noteNeeded } = plan({ now: new Date("2026-11-25T09:00:00+05:00"), employees: [{ ...employee, isDriver: true, standardDutyHours: 12 }] });
    expect(writes).toMatchObject([{ punches: null, dutyHours: "12.00" }]);
    expect(noteNeeded).toBe(true);
  });

  it("ignores empty shift rows and refuses half-filled, overlapping or over-long ones", () => {
    const count = (...shifts: [string, string][]) => buildShiftPunches("2026-11-25", shifts.map(([start, end]) => ({ start, end })))?.length ?? null;
    expect(count(["08:00", "16:00"], ["", ""])).toBe(2);
    expect(count(["08:00", "12:00"], ["12:00", "16:00"])).toBe(4);
    expect(count(["14:00", "18:00"], ["20:00:00", "02:00:00"])).toBe(4);
    expect(count()).toBeNull();
    expect(count(["", ""])).toBeNull();
    expect(count(["08:00", ""])).toBeNull();
    expect(count(["08:00", "12:00"], ["11:00", "15:00"])).toBeNull();
    expect(count(["06:00", "14:00"], ["22:00", "07:00"])).toBeNull();
    expect(count(["18:00", "02:00"], ["03:00", "05:00"])).toBeNull();
  });

  it("counts calendar days across month ends and leap years", () => {
    expect(datesBetween("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(datesBetween("2026-11-02", "2026-11-01")).toEqual([]);
    expect([isRealDate("2028-02-29"), isRealDate("2026-02-29"), isRealDate("2026-2-1"), isRealDate("")]).toEqual([true, false, false, false]);
  });

  it("says what was saved and only the skips that happened", () => {
    const { summary } = plan({ dates: ["2026-11-25", "2026-11-27"] });
    expect(bulkResultMessage(summary)).toBe("1 day added, 0 days replaced. Skipped: 1 rest days.");
  });
});
