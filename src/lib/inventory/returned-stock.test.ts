import { describe, expect, it } from "vitest";
import {
  poolShare,
  RETURNED_STOCK_MOVEMENT_LABELS,
  returnedPacking,
  returnedStockMoneyEvents,
  salvageSplit,
  secondsSaleAmount,
  writeDownAmount,
} from "./returned-stock";

describe("returned stock money rules", () => {
  it("splits received damaged packs into stock value and write-off", () => {
    expect(salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 5, cost: "30.00" }))
      .toEqual({ stockValue: "15.00", writeOff: "15.00" });
    expect(salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 0, cost: "30.00" }))
      .toEqual({ stockValue: "0.00", writeOff: "30.00" });
    expect(salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 10, cost: "30.00" }))
      .toEqual({ stockValue: "30.00", writeOff: "0.00" });
    expect(() => salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 11, cost: "30.00" }))
      .toThrow("Mango 1L: salvage value Rs 33.00 is more than what these 3 packs cost (Rs 30.00).");
    expect(() => salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: -1, cost: "30.00" }))
      .toThrow("Mango 1L: salvage value can't be below zero.");
  });

  it("takes value out of a pool the same way its average is kept", () => {
    expect(poolShare({ units: 3, value: "10.00" }, 1)).toBe("3.33");
    expect(poolShare({ units: 3, value: "10.00" }, 3)).toBe("10.00");
    expect(poolShare({ units: 4, value: "0.00" }, 2)).toBe("0.00");
    expect(() => poolShare({ units: 1, value: "2.00" }, 5)).toThrow("Only 1 pack is in this stock.");
    expect(() => poolShare({ units: 4, value: "2.00" }, 5)).toThrow("Only 4 packs are in this stock.");
    expect(() => poolShare({ units: 4, value: "2.00" }, 0)).toThrow("Pick at least 1 pack.");
  });

  it("only lets value go down and returns the loss", () => {
    expect(writeDownAmount({ units: 4, value: "20.00" }, 2)).toEqual({ newValue: "8.00", writeDown: "12.00" });
    expect(writeDownAmount({ units: 4, value: "20.00" }, 0)).toEqual({ newValue: "0.00", writeDown: "20.00" });
    expect(() => writeDownAmount({ units: 4, value: "20.00" }, 6))
      .toThrow("The new value (Rs 24.00) is above the current value (Rs 20.00). Value can only be lowered.");
    expect(() => writeDownAmount({ units: 4, value: "20.00" }, 5)).toThrow("The value is unchanged.");
    expect(() => writeDownAmount({ units: 0, value: "0.00" }, 0)).toThrow("There are no packs left to value.");
    expect(() => writeDownAmount({ units: 4, value: "20.00" }, -1)).toThrow("Value per pack can't be below zero.");
  });

  it("prices a seconds sale and reads packing from the item", () => {
    expect(secondsSaleAmount(3, "12.50")).toBe("37.50");
    expect(returnedPacking({ cartonPackagingId: "c1", containersPerCarton: 12 })).toEqual({ unitsPerCarton: 12, usesCartons: true });
    expect(returnedPacking({ cartonPackagingId: null, containersPerCarton: 12 })).toEqual({ unitsPerCarton: 1, usesCartons: false });
    expect(returnedPacking({ cartonPackagingId: "c1", containersPerCarton: 0 })).toEqual({ unitsPerCarton: 1, usesCartons: false });
    expect(RETURNED_STOCK_MOVEMENT_LABELS).toEqual({ scrap: "Scrapped", seconds_sale: "Sold as seconds", revalue: "Value lowered" });
  });

  it("dates movement losses and reverses voided ones on the void date", () => {
    const movementDate = new Date("2026-12-03T10:00:00Z");
    const voidedAt = new Date("2027-01-04T10:00:00Z");
    expect(returnedStockMoneyEvents({ kind: "scrap", lossAmount: "12.00", movementDate, voidedAt: null }))
      .toEqual([{ line: "write_off", date: movementDate, amount: 12 }]);
    expect(returnedStockMoneyEvents({ kind: "seconds_sale", lossAmount: "-10.00", movementDate, voidedAt }))
      .toEqual([
        { line: "write_off", date: movementDate, amount: -10 },
        { line: "write_off", date: voidedAt, amount: 10 },
      ]);
    expect(returnedStockMoneyEvents({ kind: "revalue", lossAmount: "4.00", movementDate, voidedAt: null }))
      .toEqual([{ line: "write_down", date: movementDate, amount: 4 }]);
  });
});
