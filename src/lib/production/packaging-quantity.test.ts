import { describe, expect, it } from "vitest";
import { getFillPerContainer, getPackagingTarget } from "./packaging-quantity";

describe("packaging bulk conversion", () => {
  it("accepts liters as stored by the recipe form", () => {
    expect(getPackagingTarget(10, "1", "L", "liters")).toBe(10);
    expect(getPackagingTarget(10, "500", "ml", "liters")).toBe(20);
  });
  it("floors decimal ratios without losing a container to binary rounding", () => {
    expect(getPackagingTarget(0.3, "100", "g", "kg")).toBe(3);
    expect(getPackagingTarget(0.299, "100", "g", "kg")).toBe(2);
  });
  it("rejects incompatible and nonpositive fills", () => {
    expect(() => getFillPerContainer("1", "L", "kg")).toThrow("match");
    expect(() => getFillPerContainer("0", "g", "kg")).toThrow("positive");
  });
});
