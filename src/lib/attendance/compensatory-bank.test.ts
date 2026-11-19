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

describe("maxCoverHours with late/early items", () => {
  it("covers rejected late minutes", () => {
    expect(
      maxCoverHours({
        standardHours: 8,
        dutyHours: 7.5,
        balance: 8,
        currentCover: 0,
        timeExceptions: [{ kind: "late", minutes: 30, status: "rejected" }],
      }),
    ).toBe(0.5);
  });

  it("offers nothing for excused or pending minutes that cost no pay", () => {
    for (const status of ["approved_excused", "approved_official", "pending"] as const)
      expect(
        maxCoverHours({
          standardHours: 8,
          dutyHours: 7.5,
          balance: 8,
          currentCover: 0,
          timeExceptions: [{ kind: "early", minutes: 30, status }],
        }),
      ).toBe(0);
  });

  it("covers rejected minutes plus unexplained undertime", () => {
    expect(
      maxCoverHours({
        standardHours: 8,
        dutyHours: 6,
        balance: 8,
        currentCover: 0,
        timeExceptions: [
          { kind: "late", minutes: 30, status: "approved_excused" },
          { kind: "early", minutes: 60, status: "rejected" },
        ],
      }),
    ).toBe(1.5);
  });
});

describe("compCashOutAmount", () => {
  it("pays hours at the overtime rate, rounded to paisa", () => {
    expect(compCashOutAmount(12, 312.5)).toBe(3750);
    expect(compCashOutAmount(1.5, 333.3333)).toBe(500);
  });
});
