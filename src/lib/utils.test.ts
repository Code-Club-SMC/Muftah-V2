import { describe, expect, it } from "vitest";
import { plainNumber } from "./utils";

describe("plainNumber", () => {
  it("strips trailing decimal zeroes from padded numeric strings", () => {
    expect(plainNumber("100.000")).toBe("100");
    expect(plainNumber("37.50")).toBe("37.5");
    expect(plainNumber("0.00")).toBe("0");
    expect(plainNumber("-0.00")).toBe("0");
    expect(plainNumber("-73.2500")).toBe("-73.25");
  });

  it("preserves whole numbers, significant decimals, and non-numeric strings", () => {
    expect(plainNumber("1000")).toBe("1000");
    expect(plainNumber("12.34")).toBe("12.34");
    expect(plainNumber(250)).toBe("250");
    expect(plainNumber(0)).toBe("0");
    expect(plainNumber("abc")).toBe("abc");
  });

  it("handles null, undefined, and whitespace", () => {
    expect(plainNumber(null)).toBe("");
    expect(plainNumber(undefined)).toBe("");
    expect(plainNumber("")).toBe("");
    expect(plainNumber("  42.00  ")).toBe("42");
  });
});
