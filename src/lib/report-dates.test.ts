import { describe, expect, it, vi } from "vitest";
import {
  currentReportMonth,
  datePickerKey,
  formatReportDate,
  formatReportTimestamp,
  reportDateBounds,
  reportDateKey,
} from "./report-dates";
import {
  createComparisonLabel,
  createPreviousRange,
  createReportDateRange,
} from "@/server-functions/reports/profit-loss/reporting-math";

describe("Pakistan reporting calendar", () => {
  it("includes precisely one Pakistan day", () => {
    expect(
      reportDateBounds({ dateFrom: "2026-10-13", dateTo: "2026-10-13" }),
    ).toEqual({
      fromDate: new Date("2026-10-12T19:00:00Z"),
      toDate: new Date("2026-10-13T18:59:59.999Z"),
    });
    expect(
      reportDateBounds({
        dateFrom: "2026-10-12T19:00:00Z",
        dateTo: "2026-10-13T18:00:00Z",
      }),
    ).toEqual(
      reportDateBounds({ dateFrom: "2026-10-13", dateTo: "2026-10-13" }),
    );
    expect(reportDateKey("2026-10-12T19:00:00Z")).toBe("2026-10-13");
    expect(reportDateKey("2026-10-13T18:59:59.999Z")).toBe("2026-10-13");
    expect(reportDateKey("2026-10-13T19:00:00Z")).toBe("2026-10-14");
  });
  it("rejects malformed, impossible, ambiguous and reversed inputs", () => {
    for (const dateFrom of [
      "2026-02-30",
      "2025-02-29",
      "garbage",
      "10/13/2026",
      "2026-10-13T00:00:00",
      "2026-02-30T00:00:00Z",
      "2026-10-13T24:00:00Z",
      "2026-10-13T00:00:00+05:99",
      "",
    ])
      expect(() => reportDateBounds({ dateFrom })).toThrow();
    expect(() =>
      reportDateBounds({ dateFrom: "2026-10-14", dateTo: "2026-10-13" }),
    ).toThrow();
    expect(() => reportDateKey(new Date(NaN))).toThrow();
  });
  it("preserves absent endpoints and leap dates", () => {
    expect(reportDateBounds({})).toEqual({});
    expect(reportDateBounds({ dateTo: "2024-02-29" })).toEqual({
      toDate: new Date("2024-02-29T18:59:59.999Z"),
    });
  });
  it("formats dates and keeps picker calendar values", () => {
    expect(datePickerKey(new Date(2026, 9, 13))).toBe("2026-10-13");
    expect(formatReportDate("2026-10-12T20:00:00Z")).toBe("13 Oct 2026");
    expect(formatReportTimestamp("2026-10-12T20:00:00Z")).toBe(
      "13 Oct 2026, 01:00 PKT",
    );
  });
  it("defaults to the Pakistan month across UTC month rollover", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-12-31T20:00:00Z"));
      expect(currentReportMonth()).toEqual({
        from: "2027-01-01",
        to: "2027-01-31",
      });
      expect(createReportDateRange()).toEqual(
        reportDateBounds({ dateFrom: "2027-01-01", dateTo: "2027-01-31" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("compares calendar months and equal custom day counts", () => {
    const month = createReportDateRange({
      dateFrom: "2024-03-01",
      dateTo: "2024-03-31",
    });
    const previous = createPreviousRange(month);
    expect(previous).toEqual(
      reportDateBounds({ dateFrom: "2024-02-01", dateTo: "2024-02-29" }),
    );
    expect(createComparisonLabel(month, previous)).toBe("vs Feb 2024");
    expect(
      createPreviousRange(
        createReportDateRange({ dateFrom: "2027-01-01", dateTo: "2027-01-03" }),
      ),
    ).toEqual(
      reportDateBounds({ dateFrom: "2026-12-29", dateTo: "2026-12-31" }),
    );
  });
});
