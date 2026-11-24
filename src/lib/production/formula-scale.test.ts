import { describe, expect, it } from "vitest";
import { batchPercent, scaleQuantity, totalQuantity, typedQuantity } from "./formula-scale";

const type = (row: ReturnType<typeof typedQuantity>, ...sizes: string[]) => sizes.reduce(scaleQuantity, row).quantityPerBatch;

describe("formula scaling", () => {
  it("doubles ingredients when the batch doubles", () => {
    expect(type(typedQuantity("50", "100"), "200")).toBe("100");
    expect(type(typedQuantity("50.000", "100.00"), "50")).toBe("25");
  });
  it("does not add up rounding while the size is being typed", () => {
    expect(type(typedQuantity("33.333", "100"), "", "2", "20", "200")).toBe("66.666");
    expect(type(typedQuantity("0.004", "100"), "1", "10", "100")).toBe("0.004");
  });
  it("leaves amounts alone for an empty, zero or invalid size", () => {
    for (const size of ["", "0", "-5", "1e", "abc"]) expect(type(typedQuantity("50", "100"), size)).toBe("50");
  });
  it("scales from an amount typed after the size changed", () => {
    expect(type(typedQuantity("80", "200"), "100")).toBe("40");
  });
  it("starts from the first valid size when an amount was typed without one", () => {
    expect(type(typedQuantity("50", ""), "100")).toBe("50");
    expect(type(typedQuantity("50", ""), "100", "200")).toBe("100");
  });
  it("keeps an empty ingredient empty", () => {
    expect(type(typedQuantity("0", "100"), "200")).toBe("0");
  });
  it("gives each share of the batch", () => {
    expect(batchPercent("50", "100")).toBe("50%");
    expect(batchPercent("100", "200")).toBe("50%");
    expect(batchPercent("12", "500.00")).toBe("2.4%");
    expect(batchPercent("12", "")).toBeNull();
    expect(totalQuantity(["50", "50.5", ""]).toString()).toBe("100.5");
  });
});
