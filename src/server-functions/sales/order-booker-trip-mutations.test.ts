import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TRIPS_SOURCE = readFileSync(
  join(process.cwd(), "src/server-functions/sales/order-booker-trips-fn.ts"),
  "utf8",
);

const ORDERS_SOURCE = readFileSync(
  join(process.cwd(), "src/server-functions/sales/orders-fn.ts"),
  "utf8",
);

describe("order-booker trip mutation wiring", () => {
  it("requires shop type in empty-trip and order-pad trip inputs", () => {
    expect(TRIPS_SOURCE).toContain("shopType: z.enum([\"old\", \"new\"])");
    expect(ORDERS_SOURCE).toContain("shopType: z.enum([\"old\", \"new\"])");
  });

  it("validates and syncs empty-trip creation inside one transaction", () => {
    expect(TRIPS_SOURCE).toContain("return await db.transaction(async (tx) =>");
    expect(TRIPS_SOURCE).toContain("resolveOrderBookerTripEligibility({");
    expect(TRIPS_SOURCE).toContain("assertOrderBookerTripAllowed(eligibility)");
    expect(TRIPS_SOURCE).toContain("shopType: data.shopType");
    expect(TRIPS_SOURCE).toContain("syncOrderBookerAttendanceForDate({");
  });

  it("resyncs both old and new business dates when a trip is updated", () => {
    expect(TRIPS_SOURCE).toContain("const oldEligibility = await");
    expect(TRIPS_SOURCE).toContain("const newEligibility = await");
    expect(TRIPS_SOURCE).toContain("excludeTripId: id");
    expect(TRIPS_SOURCE).toContain(
      "if (newEligibility.businessDate !== oldEligibility.businessDate)",
    );
  });

  it("loads before deleting and resyncs the deleted trip date", () => {
    expect(TRIPS_SOURCE).toContain("const existing = await tx.query.orderBookerTrips.findFirst");
    expect(TRIPS_SOURCE).toContain("await tx.delete(orderBookerTrips)");
    expect(TRIPS_SOURCE).toContain("businessDate: eligibility.businessDate");
  });

  it("validates and syncs order-pad inline trip creation in the order transaction", () => {
    expect(ORDERS_SOURCE).toContain("resolveOrderBookerTripEligibility({");
    expect(ORDERS_SOURCE).toContain("assertOrderBookerTripAllowed(eligibility)");
    expect(ORDERS_SOURCE).toContain("shopType: data.trip.shopType");
    expect(ORDERS_SOURCE).toContain("await syncOrderBookerAttendanceForDate({");
  });

  it("does not allow order creation to attach to an existing trip", () => {
    const createOrderInput = ORDERS_SOURCE.slice(
      ORDERS_SOURCE.indexOf("export const createOrderFn"),
      ORDERS_SOURCE.indexOf("export const updateOrderFn"),
    );

    expect(createOrderInput).not.toContain("tripId: z.string().optional()");
    expect(createOrderInput).toContain("let tripId: string | undefined;");
  });
});
