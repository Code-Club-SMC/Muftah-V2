import { describe, expect, it } from "vitest";
import { stockStatus } from "./stock-status";
import {
  chemicalStockThresholdSchema,
  packagingStockThresholdSchema,
  addChemicalSchema,
  addPackagingMaterialSchema,
} from "@/lib/validators/validators";

describe("stock status and thresholds", () => {
  it.each([
    ["0", null, "out"],
    ["0", "0", "out"],
    ["-0.01", "5", "out"],
    ["2", "0", "healthy"],
    ["4.99", "5", "low"],
    ["5", "5", "low"],
    ["5.01", "5", "healthy"],
    ["99999999.991", "99999999.99", "healthy"],
    ["0.10000000000000001", "0.1", "healthy"],
  ] as const)(
    "classifies %s against %s as %s",
    (quantity, minimum, expected) => {
      expect(stockStatus(quantity, minimum)).toBe(expected);
    },
  );
  it.each(["", " ", "-1", "NaN", "Infinity", "1junk", NaN, Infinity, -1])(
    "rejects malformed or negative threshold %s",
    (value) => {
      expect(chemicalStockThresholdSchema.safeParse(value).success).toBe(false);
      expect(packagingStockThresholdSchema.safeParse(value).success).toBe(
        false,
      );
    },
  );
  it("enforces exact decimal and integer storage boundaries", () => {
    for (const value of [0, "0", 5.25, "99999999.99"])
      expect(chemicalStockThresholdSchema.safeParse(value).success).toBe(true);
    for (const value of ["1.001", "100000000", 100000000])
      expect(chemicalStockThresholdSchema.safeParse(value).success).toBe(false);
    for (const value of [0, "0", "2147483647"])
      expect(packagingStockThresholdSchema.safeParse(value).success).toBe(true);
    for (const value of [1.5, "1.5", "2147483648"])
      expect(packagingStockThresholdSchema.safeParse(value).success).toBe(
        false,
      );
    expect(
      addChemicalSchema.shape.minimumStockLevel.safeParse("1junk").success,
    ).toBe(false);
    expect(
      addPackagingMaterialSchema.shape.minimumStockLevel.safeParse(1.5).success,
    ).toBe(false);
  });
});
