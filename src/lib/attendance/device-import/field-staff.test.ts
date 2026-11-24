import { describe, expect, it } from "vitest";
import { planFieldStaffRows } from "./field-staff";

const row = (date: string | null, punches: string[], issues: string[] = []) => ({
  rowNumber: 2, personId: "7", personName: "Bilal", department: "Sales", date, punches, reportedCount: null, issues,
});
const plan = (rows: ReturnType<typeof row>[], attendanceRows: { date: string; status: string }[] = [], locked: string[] = []) =>
  planFieldStaffRows({ rows, attendanceRows, lockedDates: new Set(locked), joiningDate: "2026-01-01", now: new Date("2026-10-14T12:00:00+05:00") })
    .map(({ status, marksPresent }) => [status, marksPresent]);

describe("field staff in a device report", () => {
  it("marks a day with one or many punches present", () => {
    expect(plan([row("2026-10-12", ["09:00"]), row("2026-10-13", ["09:00", "13:00", "18:00"])])).toEqual([["ready", true], ["ready", true]]);
  });
  it("does not need the punch times to make sense", () => {
    expect(plan([row("2026-10-13", ["18:00", "09:00"], ["Punch times must be in chronological order"])])).toEqual([["ready", true]]);
  });
  it("marks a day once when the report repeats it", () => {
    expect(plan([row("2026-10-13", ["09:00"]), row("2026-10-13", ["18:00"])])).toEqual([["ready", true], ["unchanged", false]]);
  });
  it("leaves days without punches to HR, unless they are already decided", () => {
    expect(plan([row("2026-10-12", []), row("2026-10-13", [])], [{ date: "2026-10-13", status: "leave" }])).toEqual([["needs_review", false], ["unchanged", false]]);
  });
  it("keeps saved days, HR decisions and locked payroll", () => {
    expect(plan([row("2026-10-11", ["09:00"]), row("2026-10-12", ["09:00"]), row("2026-10-13", ["09:00"])],
      [{ date: "2026-10-11", status: "present" }, { date: "2026-10-12", status: "leave" }], ["2026-10-13"]))
      .toEqual([["unchanged", false], ["blocked", false], ["blocked", false]]);
  });
  it("tells HR why a day they decided was kept and what to do", () => {
    const [kept] = planFieldStaffRows({ rows: [row("2026-10-12", ["09:00", "18:00"])], attendanceRows: [{ date: "2026-10-12", status: "leave" }], lockedDates: new Set(), joiningDate: "2026-01-01", now: new Date("2026-10-14T12:00:00+05:00") });
    expect(kept.messages).toEqual(["HR marked this day leave, but the device has 2 punches. HR's decision is kept. If they worked, use Review day to change it to Present."]);
  });
  it("sends future, undated and pre-joining rows to HR", () => {
    expect(plan([row("2026-10-15", ["09:00"]), row("2026-10-14", ["18:00"]), row(null, ["09:00"]), row("2025-12-31", ["09:00"])]))
      .toEqual(Array(4).fill(["needs_review", false]));
  });
});
