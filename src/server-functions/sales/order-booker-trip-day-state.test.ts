import { describe, expect, it } from "vitest";
import {
  getBusinessDateFromTripDate,
  getBusinessDateRange,
  getBusinessDateWeekday,
  getOrderBookerBlockingStatus,
  getOrderBookerManualStatus,
  getOrderBookerTripBlockMessage,
  isBusinessDateRestDay,
  isManualOrderBookerAttendanceRow,
  isTripDrivenOrderBookerAttendanceRow,
} from "./order-booker-trip-day-state";

describe("order-booker trip day state rules", () => {
  it("computes the PKT business date from trip timestamps", () => {
    expect(getBusinessDateFromTripDate("2026-07-02T19:30:00.000Z")).toBe(
      "2026-07-03",
    );
    expect(getBusinessDateFromTripDate("2026-07-03")).toBe("2026-07-03");
  });

  it("builds a PKT day range for timestamp trip queries", () => {
    const range = getBusinessDateRange("2026-07-03");

    expect(range.start.toISOString()).toBe("2026-07-02T19:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-07-03T19:00:00.000Z");
  });

  it("detects rest days from the business date, not server timezone", () => {
    expect(getBusinessDateWeekday("2026-07-05")).toBe(0);
    expect(isBusinessDateRestDay("2026-07-05", [0])).toBe(true);
    expect(isBusinessDateRestDay("2026-07-05", [])).toBe(false);
  });

  it("classifies only order_booker_trip rows as auto-managed", () => {
    expect(
      isTripDrivenOrderBookerAttendanceRow({
        entrySource: "order_booker_trip",
      }),
    ).toBe(true);
    expect(isManualOrderBookerAttendanceRow({ entrySource: "manual" })).toBe(
      true,
    );
    expect(isManualOrderBookerAttendanceRow({ entrySource: null })).toBe(true);
    expect(isManualOrderBookerAttendanceRow(null)).toBe(false);
  });

  it("blocks rest days before manual status checks", () => {
    expect(
      getOrderBookerBlockingStatus({
        isRestDay: true,
        attendanceRow: { status: "present", entrySource: "manual" },
      }),
    ).toBe("rest_day");
  });

  it("blocks manual holiday, leave, and absent rows", () => {
    expect(
      getOrderBookerBlockingStatus({
        isRestDay: false,
        attendanceRow: { status: "holiday", entrySource: "manual" },
      }),
    ).toBe("holiday");
    expect(
      getOrderBookerBlockingStatus({
        isRestDay: false,
        attendanceRow: { status: "leave", entrySource: "manual" },
      }),
    ).toBe("leave");
    expect(
      getOrderBookerBlockingStatus({
        isRestDay: false,
        attendanceRow: { status: "absent", entrySource: "manual" },
      }),
    ).toBe("absent");
  });

  it("allows manual present and trip-driven present rows", () => {
    expect(
      getOrderBookerBlockingStatus({
        isRestDay: false,
        attendanceRow: { status: "present", entrySource: "manual" },
      }),
    ).toBeNull();
    expect(
      getOrderBookerBlockingStatus({
        isRestDay: false,
        attendanceRow: { status: "present", entrySource: "order_booker_trip" },
      }),
    ).toBeNull();
    expect(
      getOrderBookerManualStatus({
        status: "present",
        entrySource: "order_booker_trip",
      }),
    ).toBeNull();
  });

  it("returns clear user-facing block messages", () => {
    expect(getOrderBookerTripBlockMessage("holiday")).toContain("holiday");
    expect(getOrderBookerTripBlockMessage("leave")).toContain("leave");
    expect(getOrderBookerTripBlockMessage("absent")).toContain("absent");
    expect(getOrderBookerTripBlockMessage("rest_day")).toContain("rest day");
    expect(getOrderBookerTripBlockMessage(null)).toBeNull();
  });
});
