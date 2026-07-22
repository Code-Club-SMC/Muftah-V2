import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/components/hr/attendance/order-booker-attendance-log.tsx",
  "utf8",
);

describe("order booker attendance log", () => {
  it("uses the trip/order-backed activity log query", () => {
    expect(source).toContain("getOrderBookerActivityLogFn");
    expect(source).toContain('"order-booker-activity-log"');
    expect(source).not.toContain("getEmployeeAttendanceLogFn");
  });

  it("shows attendance status plus trip and order activity columns", () => {
    expect(source).toContain("StatusBadge");
    expect(source).toContain('header: "Trips"');
    expect(source).toContain('header: "Shops"');
    expect(source).toContain('header: "Area"');
    expect(source).toContain('header: "Distance / TA"');
    expect(source).toContain('header: "Fuel"');
    expect(source).toContain('header: "Orders"');
  });

  it("does not depend on legacy attendance snapshot sales fields", () => {
    expect(source).not.toContain("saleAmount");
    expect(source).not.toContain("recoveryAmount");
    expect(source).not.toContain("petrolAmount");
    expect(source).not.toContain("areaVisited");
  });
});
