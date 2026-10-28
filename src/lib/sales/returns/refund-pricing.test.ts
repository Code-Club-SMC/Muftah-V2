import { describe, expect, it } from "vitest";
import {
  calculateReturnLineRefund,
  getMaxRefundPerUnit,
  getReturnableUnits,
  getReturnUnitsPerCarton,
  resolveRefundPerUnit,
  sumMoney,
} from "./refund-pricing";

const line = (overrides: Partial<Parameters<typeof getReturnableUnits>[0]> = {}) => ({
  numberOfCartons: 0,
  quantity: 0,
  packsPerCarton: 0,
  actualPackSize: 0,
  amount: "0",
  ...overrides,
});

describe("getReturnUnitsPerCarton", () => {
  it("prefers packsPerCarton, then actualPackSize, then 1", () => {
    expect(getReturnUnitsPerCarton({ packsPerCarton: 12, actualPackSize: 6 })).toBe(12);
    expect(getReturnUnitsPerCarton({ packsPerCarton: 0, actualPackSize: 6 })).toBe(6);
    expect(getReturnUnitsPerCarton({ packsPerCarton: null, actualPackSize: null })).toBe(1);
  });
});

describe("getReturnableUnits", () => {
  it("counts cartons times units per carton plus loose units", () => {
    expect(getReturnableUnits(line({ numberOfCartons: 2, quantity: 3, packsPerCarton: 12 }))).toBe(27);
  });
});

describe("getMaxRefundPerUnit", () => {
  it("spreads the line amount over returnable units and rounds down", () => {
    expect(getMaxRefundPerUnit(line({ quantity: 3, amount: "1000" }), { itemsTotal: "1000" })).toBe("333.33");
  });

  it("takes off the line's share of the invoice discount", () => {
    expect(
      getMaxRefundPerUnit(line({ quantity: 10, amount: "1000" }), { invoiceDiscount: "100", itemsTotal: "2000" }),
    ).toBe("95.00");
  });

  it("returns 0.00 for a zero-amount line", () => {
    expect(getMaxRefundPerUnit(line({ quantity: 5, amount: "0" }), { itemsTotal: "0" })).toBe("0.00");
  });

  it("returns 0.00 when the line has no returnable units", () => {
    expect(getMaxRefundPerUnit(line({ amount: "500" }), { itemsTotal: "500" })).toBe("0.00");
  });

  it("never lets a full return exceed the line net", () => {
    const item = line({ quantity: 7, amount: "100" });
    const max = getMaxRefundPerUnit(item, { itemsTotal: "100" });
    expect(Number(calculateReturnLineRefund(7, max))).toBeLessThanOrEqual(100);
  });
});

describe("calculateReturnLineRefund and sumMoney", () => {
  it("multiplies exactly and rounds half up", () => {
    expect(calculateReturnLineRefund(3, "0.10")).toBe("0.30");
    expect(calculateReturnLineRefund(1, "333.335")).toBe("333.34");
  });

  it("adds without float drift", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney([])).toBe("0.00");
  });
});

describe("resolveRefundPerUnit", () => {
  const base = { max: "95.00", canOverride: false, label: "1L Bottle" };

  it("defaults to the max when nothing is requested", () => {
    expect(resolveRefundPerUnit({ ...base })).toEqual({ refundPerUnit: "95.00", overridden: false });
  });

  it("accepts a price at or below the max", () => {
    expect(resolveRefundPerUnit({ ...base, requested: 80 })).toEqual({ refundPerUnit: "80.00", overridden: false });
    expect(resolveRefundPerUnit({ ...base, requested: "95" })).toEqual({ refundPerUnit: "95.00", overridden: false });
  });

  it("rejects a price above the max without the override permission", () => {
    expect(() => resolveRefundPerUnit({ ...base, requested: 100 })).toThrow(
      "Refund per unit for 1L Bottle (Rs 100.00) is above the invoice price (Rs 95.00).",
    );
  });

  it("requires a reason to override", () => {
    expect(() => resolveRefundPerUnit({ ...base, canOverride: true, requested: 100, overrideReason: "  " })).toThrow(
      "A reason is required to refund above the invoice price.",
    );
  });

  it("marks an override when permitted and reasoned", () => {
    expect(
      resolveRefundPerUnit({ ...base, canOverride: true, requested: 100, overrideReason: "Goodwill" }),
    ).toEqual({ refundPerUnit: "100.00", overridden: true });
  });

  it("rejects negative prices", () => {
    expect(() => resolveRefundPerUnit({ ...base, requested: -1 })).toThrow("Refund per unit cannot be negative.");
  });
});
