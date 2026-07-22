import { describe, expect, it } from "vitest";
import { parseOrderBookerTripForm } from "./order-booker-trip-form";

describe("order booker trip form rules", () => {
  it("allows zero-distance empty trips and keeps shop type", () => {
    const parsed = parseOrderBookerTripForm({
      tripDate: "2026-07-13",
      destination: "Model Town",
      shopType: "new",
      distanceKm: "0",
      vehicleType: "own_vehicle",
      fuelCost: "0",
      notes: "",
    });

    expect(parsed).toMatchObject({
      tripDate: "2026-07-13",
      destination: "Model Town",
      shopType: "new",
      distanceKm: 0,
      vehicleType: "own_vehicle",
      fuelCost: 0,
    });
    expect(parsed.notes).toBeUndefined();
  });

  it("trims destination and clears fuel cost for company vehicle", () => {
    const parsed = parseOrderBookerTripForm({
      tripDate: "2026-07-13",
      destination: "  Old Bazaar  ",
      shopType: "old",
      distanceKm: 4.5,
      vehicleType: "company_vehicle",
      fuelCost: 999,
      notes: "  visited before closing  ",
    });

    expect(parsed.destination).toBe("Old Bazaar");
    expect(parsed.fuelCost).toBe(0);
    expect(parsed.notes).toBe("visited before closing");
  });

  it("rejects missing destination and negative distance", () => {
    expect(() =>
      parseOrderBookerTripForm({
        tripDate: "2026-07-13",
        destination: " ",
        shopType: "old",
        distanceKm: -1,
        vehicleType: "own_vehicle",
        fuelCost: 0,
        notes: "",
      }),
    ).toThrow();
  });
});
