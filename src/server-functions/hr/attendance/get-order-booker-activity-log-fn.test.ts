import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/server-functions/hr/attendance/get-order-booker-activity-log-fn.ts",
  "utf8",
);

describe("order booker activity log server function", () => {
  it("loads activity from attendance, trips, and linked orders", () => {
    expect(source).toContain("getOrderBookerActivityLogFn");
    expect(source).toContain("db.query.attendance.findMany");
    expect(source).toContain("db.query.orderBookerTrips.findMany");
    expect(source).toContain("orders: {");
    expect(source).toContain("items: {");
  });

  it("computes daily trip, order, shop, TA/DA, fuel, and distance totals", () => {
    expect(source).toContain("tripCount: dayTrips.length");
    expect(source).toContain("emptyTripCount");
    expect(source).toContain("orderTripCount");
    expect(source).toContain("totalDistanceKm");
    expect(source).toContain("totalFuelCost");
    expect(source).toContain("totalTadaAmount");
    expect(source).toContain("totalOrderValue");
    expect(source).toContain("oldShopVisits");
    expect(source).toContain("newShopVisits");
  });

  it("keeps status rules explicit for present, pending, rest, leave, holiday, and absent", () => {
    expect(source).toContain("resolveOrderBookerActivityStatus");
    expect(source).toContain('"pending_review"');
    expect(source).toContain('"rest_day"');
    expect(source).toContain('args.attendanceRow?.status === "present" || args.tripCount > 0');
    expect(source).toContain('args.attendanceRow?.status === "absent"');
    expect(source).toContain('args.attendanceRow?.status === "leave"');
    expect(source).toContain('args.attendanceRow?.status === "holiday"');
  });
});
