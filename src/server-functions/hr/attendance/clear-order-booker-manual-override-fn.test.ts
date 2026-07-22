import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/server-functions/hr/attendance/clear-order-booker-manual-override-fn.ts",
  "utf8",
);

describe("clear order-booker manual override source", () => {
  it("only clears manual order-booker rows", () => {
    expect(source).toContain("if (!employee.isOrderBooker)");
    expect(source).toContain("Manual override reset is only valid for order bookers.");
    expect(source).toContain(
      "existingAttendance.entrySource === ORDER_BOOKER_TRIP_ENTRY_SOURCE",
    );
    expect(source).toContain("This day is already trip-driven.");
  });

  it("deletes the manual row and resyncs trip-driven attendance", () => {
    expect(source).toContain(".delete(attendance)");
    expect(source).toContain("syncOrderBookerAttendanceForDate({");
    expect(source).toContain("businessDate: data.date");
    expect(source).toContain("restoredTripDriven");
  });
});
