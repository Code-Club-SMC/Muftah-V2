import { describe, expect, it } from "vitest";
import { planDeviceEmployeeRows } from "./timeline";

const row = (date: string, punches: string[], rowNumber = 3) => ({
  rowNumber,
  personId: "112009",
  personName: "Employee",
  department: "Factory",
  date,
  punches,
  reportedCount: punches.length,
  issues: [],
});
const plan = (rows: ReturnType<typeof row>[], extra = {}) =>
  planDeviceEmployeeRows({
    rows,
    existingPunches: [],
    claims: [],
    attendanceRows: [],
    lockedDates: new Set<string>(),
    shifts: [],
    now: new Date("2026-10-14T12:00:00+05:00"),
    ...extra,
  });

describe("device punch planning", () => {
  it("leaves a zero-punch date for HR without marking absence", () => {
    const [result] = plan([row("2026-10-13", [])]);
    expect(result.status).toBe("needs_review");
    expect(result.punches).toEqual([]);
  });
  it("sums completed pairs and excludes lunch", () => {
    const [result] = plan([
      row("2026-10-13", ["08:00", "13:00", "14:00", "17:00"]),
    ]);
    expect(result.punches.map((p) => p.direction)).toEqual([
      "in",
      "out",
      "in",
      "out",
    ]);
    expect(result.dutyHours).toBe("8.00");
    expect(result.status).toBe("ready");
  });
  it("imports a historical unmatched IN for HR correction", () => {
    const [result] = plan([row("2026-10-13", ["08:00"])]);
    expect(result.status).toBe("needs_review");
    expect(result.punches).toHaveLength(1);
  });
  it("keeps today's final IN open", () => {
    const [result] = plan([row("2026-10-14", ["08:00"])]);
    expect(result.status).toBe("ready");
    expect(result.messages.join(" ")).toContain("open");
  });
  it("counts an overnight shift on the checkout date across report rows", () => {
    const results = plan([
      row("2026-10-12", ["22:00"]),
      row("2026-10-13", ["06:00"], 4),
    ]);
    expect(results[0].punches[0]).toMatchObject({
      direction: "in",
      attendanceDate: "2026-10-13",
    });
    expect(results[1].punches[0]).toMatchObject({
      direction: "out",
      attendanceDate: "2026-10-13",
    });
    expect(results[0].attendanceDates).toEqual(["2026-10-13"]);
    expect(results[0].status).toBe("ready");
    expect(results[1].dutyHours).toBe("8.00");
  });
  it("counts an 8 PM to 1 AM shift on the checkout date", () => {
    const results = plan([
      row("2026-10-01", ["20:00"]),
      row("2026-10-02", ["01:00"], 4),
    ]);
    expect(results.flatMap((r) => r.punches)).toEqual([
      expect.objectContaining({
        direction: "in",
        attendanceDate: "2026-10-02",
      }),
      expect.objectContaining({
        direction: "out",
        attendanceDate: "2026-10-02",
      }),
    ]);
    expect(results[1].dutyHours).toBe("5.00");
  });
  it("does not close a missed daytime checkout using tomorrow's arrival", () => {
    const results = plan([
      row("2026-10-12", ["08:00"]),
      row("2026-10-13", ["08:00", "17:00"], 4),
    ]);
    expect(results[0].status).toBe("needs_review");
    expect(results[1].punches[0].direction).toBe("in");
  });
  it("moves an overnight IN from an earlier upload to the checkout date", () => {
    const [result] = plan([row("2026-10-13", ["06:00"])], {
      existingPunches: [
        {
          id: "night-in",
          timestamp: "2026-10-12T22:00:00+05:00",
          attendanceDate: "2026-10-12",
          direction: "in",
        },
      ],
    });
    expect(result.attendanceDates).toEqual(["2026-10-13"]);
    expect(result.punches).toEqual([
      expect.objectContaining({
        direction: "in",
        attendanceDate: "2026-10-13",
        existingPunchId: "night-in",
        movedFromDate: "2026-10-12",
      }),
      expect.objectContaining({
        direction: "out",
        attendanceDate: "2026-10-13",
        existingPunchId: null,
      }),
    ]);
    expect(result.dutyHours).toBe("8.00");
  });
  it("retains deleted/corrected claims instead of restoring original raw times", () => {
    const [result] = plan([row("2026-10-13", ["08:00"])], {
      claims: [
        {
          timestamp: "2026-10-13T08:00:00+05:00",
          punchId: null,
          attendanceDate: "2026-10-13",
          direction: "in",
        },
      ],
    });
    expect(result.status).toBe("needs_review");
    expect(result.punches).toHaveLength(0);
  });
  it("rejects an inserted middle punch that would contradict existing directions", () => {
    const [result] = plan([row("2026-10-13", ["08:00", "09:00", "17:00"])], {
      existingPunches: [
        {
          id: "in",
          timestamp: "2026-10-13T08:00:00+05:00",
          attendanceDate: "2026-10-13",
          direction: "in",
        },
        {
          id: "out",
          timestamp: "2026-10-13T17:00:00+05:00",
          attendanceDate: "2026-10-13",
          direction: "out",
        },
      ],
    });
    expect(result.status).toBe("needs_review");
    expect(result.punches).toHaveLength(0);
  });
  it("preserves manual non-present attendance", () => {
    const [result] = plan([row("2026-10-13", ["08:00", "17:00"])], {
      attendanceRows: [
        { date: "2026-10-13", status: "leave", entrySource: "manual" },
      ],
    });
    expect(result.status).toBe("blocked");
    expect(result.punches).toHaveLength(0);
  });
  it("does not write into finalized payroll dates", () => {
    const [result] = plan([row("2026-10-13", ["08:00", "17:00"])], {
      lockedDates: new Set(["2026-10-13"]),
    });
    expect(result.status).toBe("blocked");
  });
});
