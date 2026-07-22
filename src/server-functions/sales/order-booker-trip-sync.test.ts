import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(process.cwd(), "src/server-functions/sales/order-booker-trip-sync.ts"),
  "utf8",
);

describe("order-booker trip attendance sync source contract", () => {
  it("does not overwrite manual attendance rows", () => {
    expect(SOURCE).toContain(
      "if (isManualOrderBookerAttendanceRow(existingAttendance))",
    );
    expect(SOURCE).toContain("return;");
  });

  it("deletes only auto trip-driven rows when no trips remain", () => {
    expect(SOURCE).toContain("if (trips.length === 0)");
    expect(SOURCE).toContain("existingAttendance &&");
    expect(SOURCE).toContain("isTripDrivenOrderBookerAttendanceRow");
    expect(SOURCE).toContain(".delete(attendance)");
  });

  it("marks trip days present with full standard duty hours and no punch fields", () => {
    expect(SOURCE).toContain("status: \"present\"");
    expect(SOURCE).toContain("checkIn: null");
    expect(SOURCE).toContain("checkOut: null");
    expect(SOURCE).toContain(
      "const dutyHours = Math.max(args.standardDutyHours || 8, 0).toFixed(2);",
    );
    expect(SOURCE).toContain("entrySource: ORDER_BOOKER_TRIP_ENTRY_SOURCE");
  });

  it("keeps order-booker trip attendance free of punch penalties", () => {
    expect(SOURCE).toContain("isLate: false");
    expect(SOURCE).toContain("isNightShift: false");
    expect(SOURCE).toContain("overtimeHours: \"0.00\"");
    expect(SOURCE).toContain("earlyDepartureStatus: \"none\"");
  });
});
