import { describe, expect, it } from "vitest";
import { shortestShiftHours, toPKTDate, toPKTTime } from "./time";

describe("PKT time helpers", () => {
  it("converts UTC timestamps to Pakistan date and time", () => {
    const timestamp = "2026-06-01T03:15:30.000Z";

    expect(toPKTDate(timestamp)).toBe("2026-06-01");
    expect(toPKTTime(timestamp)).toBe("08:15:30");
  });

  it("moves the date forward when UTC plus five crosses midnight", () => {
    const timestamp = "2026-06-01T21:30:00.000Z";

    expect(toPKTDate(timestamp)).toBe("2026-06-02");
    expect(toPKTTime(timestamp)).toBe("02:30:00");
  });
});


describe("shortestShiftHours", () => {
  it("returns null when no shift is scheduled", () => {
    expect(shortestShiftHours(null)).toBeNull();
    expect(shortestShiftHours([])).toBeNull();
    expect(shortestShiftHours([{ start: "09:00", end: "09:00" }])).toBeNull();
  });

  it("wraps overnight shifts past midnight", () => {
    expect(shortestShiftHours([{ start: "22:00", end: "06:00" }])).toBe(8);
  });

  it("uses the shortest of several shifts", () => {
    expect(
      shortestShiftHours([
        { start: "09:00", end: "13:00" },
        { start: "14:00", end: "20:30" },
      ]),
    ).toBe(4);
  });
});
