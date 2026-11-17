import { describe, expect, it } from "vitest";
import {
  MAX_OTHER_INCOME_AMOUNT,
  normalizeItemName,
  OTHER_INCOME_TX_SOURCE,
  otherIncomeAmount,
} from "@/lib/finance/other-income";

describe("other income helpers", () => {
  it("multiplies quantity by price and rounds to paisa", () => {
    expect(otherIncomeAmount(1, 1500)).toBe("1500.00");
    expect(otherIncomeAmount("2.5", "33.33")).toBe("83.33");
    expect(otherIncomeAmount("0.333", "10")).toBe("3.33");
  });

  it("refuses amounts that round to zero or exceed the column", () => {
    expect(() => otherIncomeAmount("0.001", "1")).toThrow("at least Rs 0.01");
    expect(() => otherIncomeAmount(2, MAX_OTHER_INCOME_AMOUNT)).toThrow("too large");
  });

  it("trims and collapses spaces in item names", () => {
    expect(normalizeItemName("  SLES   drum ")).toBe("SLES drum");
  });

  it("uses a fixed ledger source", () => {
    expect(OTHER_INCOME_TX_SOURCE).toBe("Other Income");
  });
});
