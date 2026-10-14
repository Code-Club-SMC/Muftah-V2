import Big from "big.js";
import { describe, expect, it } from "vitest";
import { calculatePackingLine, packingBulk } from "./batch-packing";
import { getPackagingTarget } from "./packaging-quantity";

const format = { fillAmount: "250", fillUnit: "g", containersPerCarton: 40, usesCartons: true };
const counts = { fullCartons: 20, partialPacks: 0, loosePacks: 0 };
describe("batch packing quantities", () => {
  it("records the 500kg example as 1,350 packs and 40 physical cartons", () => {
    const rows = [
      calculatePackingLine(counts, format, "kg"),
      calculatePackingLine({ ...counts, fullCartons: 10 }, { ...format, fillAmount: "500", containersPerCarton: 20 }, "kg"),
      calculatePackingLine({ ...counts, fullCartons: 10 }, { ...format, fillAmount: "400", containersPerCarton: 25 }, "kg"),
      calculatePackingLine({ ...counts, fullCartons: 0, loosePacks: 100 }, { ...format, fillAmount: "1", fillUnit: "kg", containersPerCarton: 0, usesCartons: false }, "kg"),
    ];
    expect(rows[0].nominalBulk).toBe("200.000");
    expect(rows.reduce((total, row) => total + row.totalPacks, 0)).toBe(1350);
    expect(rows.reduce((total, row) => total + row.physicalCartons, 0)).toBe(40);
    expect(rows.reduce((total, row) => total.plus(row.actualBulk), new Big(0)).toFixed(3)).toBe("500.000");
  });
  it("keeps outside packs outside cartons even above carton capacity", () => {
    expect(calculatePackingLine({ fullCartons: 0, partialPacks: 3, loosePacks: 101 }, format, "kg")).toEqual({ totalPacks: 104, physicalCartons: 1, nominalBulk: "26.000", actualBulk: "26.000" });
    expect(calculatePackingLine({ fullCartons: 0, partialPacks: 0, loosePacks: 101 }, format, "kg").physicalCartons).toBe(0);
  });
  it("keeps fractional packs as bulk for 100kg of 300g packs", () => {
    const total = getPackagingTarget("100", "300", "g", "kg");
    expect(total).toBe(333);
    const result = calculatePackingLine({ fullCartons: 0, partialPacks: 0, loosePacks: total }, { ...format, fillAmount: "300" }, "kg");
    expect(new Big(100).minus(result.actualBulk).toFixed(3)).toBe("0.100");
  });
  it("requires counts, correct carton distribution and exactly representable powder", () => {
    expect(() => calculatePackingLine({ ...counts, partialPacks: 40 }, format, "kg")).toThrow("less than");
    expect(() => calculatePackingLine(counts, { ...format, usesCartons: false }, "kg")).toThrow("outside packs only");
    expect(() => calculatePackingLine({ ...counts, loosePacks: 0.5 }, format, "kg")).toThrow("whole numbers");
    expect(() => calculatePackingLine({ fullCartons: 0, partialPacks: 0, loosePacks: 1 }, { ...format, fillAmount: "0.1" }, "kg")).toThrow("three decimal");
    expect(() => packingBulk("0.0001")).toThrow("three decimal");
    expect(() => calculatePackingLine({ ...counts, actualBulk: "201" }, format, "kg")).toThrow("reason");
    expect(calculatePackingLine({ ...counts, actualBulk: "201", varianceReason: "Measured heavier fill" }, format, "kg").actualBulk).toBe("201.000");
  });
});
