import { describe, expect, it } from "vitest";
import { compCashOutAmount, maxCoverHours } from "./compensatory-bank";

describe("maxCoverHours", () => {
  it("covers the whole shortfall when the bank has enough", () => {
    expect(maxCoverHours({ standardHours: 8, dutyHours: 4, balance: 4, currentCover: 0 })).toBe(4);
  });

  it("stops at the bank balance", () => {
    expect(maxCoverHours({ standardHours: 8, dutyHours: 4, balance: 2.5, currentCover: 0 })).toBe(2.5);
  });

  it("treats the day's existing cover as available again", () => {
    expect(maxCoverHours({ standardHours: 8, dutyHours: 4, balance: 0, currentCover: 3 })).toBe(3);
  });

  it("allows nothing on a full or rest day", () => {
    expect(maxCoverHours({ standardHours: 8, dutyHours: 8, balance: 10, currentCover: 0 })).toBe(0);
    expect(maxCoverHours({ standardHours: 0, dutyHours: 4, balance: 10, currentCover: 0 })).toBe(0);
  });
});

describe("compCashOutAmount", () => {
  it("pays hours at the overtime rate, rounded to paisa", () => {
    expect(compCashOutAmount(12, 312.5)).toBe(3750);
    expect(compCashOutAmount(1.5, 333.3333)).toBe(500);
  });
});
