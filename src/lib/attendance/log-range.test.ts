import { afterEach, expect, it, vi } from "vitest";
import { attendanceLogRange } from "./log-range";

afterEach(() => vi.useRealTimers());

it.each([
  ["2026-11-01T00:30:00+05:00", "2026-10-16", "2026-11-15"],
  ["2026-11-24T12:00:00+05:00", "2026-10-16", "2026-11-15"],
  ["2026-11-30T23:30:00+05:00", "2026-10-16", "2026-11-15"],
  ["2027-01-05T12:00:00+05:00", "2026-12-16", "2027-01-15"],
])("opens on the payroll month at %s", (now, startDate, endDate) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  expect(attendanceLogRange()).toEqual({ startDate, endDate });
});
it("can open another month", () => {
  expect(attendanceLogRange("2026-03")).toEqual({ startDate: "2026-02-16", endDate: "2026-03-15" });
});
