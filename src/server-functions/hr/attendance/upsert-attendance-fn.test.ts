import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/server-functions/hr/attendance/upsert-attendance-fn.ts",
  "utf8",
);

describe("upsert attendance server source", () => {
  it("recomputes punch-driven present rows instead of trusting form values", () => {
    expect(source).toContain("usesPunchDrivenPresentRow");
    expect(source).toContain(
      "!employee.isOrderBooker && rest.status === \"present\" && hasPunches",
    );
    expect(source).toContain("await lockEmployeePunchWrites(tx, employeeId)");
    expect(source).toContain("await recomputeAttendanceRow");
    expect(source).toContain("checkIn: punchDrivenAttendance.checkIn");
    expect(source).toContain("isLate: punchDrivenAttendance.isLate ?? false");
    expect(source).toContain(
      "isNightShift: punchDrivenAttendance.isNightShift ?? false",
    );
  });

  it("validates requested OT against recomputed punch-driven duty hours", () => {
    expect(source).toContain("buildOvertimeRequestSummary({");
    expect(source).toContain(
      "dutyHours: punchDrivenAttendance.dutyHours",
    );
    expect(source).toContain("standardDutyHours: standardHours");
    expect(source).toContain("requestedOvertimeHours");
    expect(source).toContain(
      "if (punchDrivenOvertimeSummary.state === \"stale\")",
    );
    expect(source).toContain(
      "\"Requested OT cannot be more than the suggested OT.\"",
    );
  });

  it("normalizes punch-driven OT saves to pending and clears remarks when OT is zero", () => {
    expect(source).toContain("normalizeRequestedOvertimeHours(");
    expect(source).toContain(
      "const hasRequestedPunchDrivenOvertime =",
    );
    expect(source).toContain(
      "punchDrivenOvertimeSummary.requestedOvertimeHours.toFixed(2)",
    );
    expect(source).toContain(
      "overtimeRemarks: hasRequestedPunchDrivenOvertime",
    );
    expect(source).toContain("overtimeStatus: \"pending\" as const");
  });

  it("enforces order-booker manual override rules server-side", () => {
    expect(source).toContain("if (employee.isOrderBooker)");
    expect(source).toContain("tx.query.orderBookers.findFirst");
    expect(source).toContain("tx.query.orderBookerTrips.findMany");
    expect(source).toContain("This date has trip records, so it must stay Present");
    expect(source).toContain(
      "A remark is required when manually resolving an order-booker day.",
    );
    expect(source).toContain(
      "entrySource: hasTrips ? ORDER_BOOKER_TRIP_ENTRY_SOURCE : \"manual\"",
    );
    expect(source).toContain("dutyHours: isPresent ? standardHours.toFixed(2) : \"0.00\"");
    expect(source).toContain("checkIn: null");
    expect(source).toContain("checkOut: null");
    expect(source).toContain("isLate: false");
    expect(source).toContain("earlyDepartureStatus: \"none\"");
  });
});
