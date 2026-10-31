import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOSS_LIMITS, batchLoss, chemicalLoss, isOverLimit, isValidLossLimit, lossPercent, piecesLoss, powderLoss, shopperLoss,
  sumMoney, toBatchRow, toPackingRow, toStoreRow, weightedShopperPercent,
} from "./loss-report";

const limits = DEFAULT_LOSS_LIMITS;
const runBase = { runId: "r1", batchId: "A0104", date: new Date("2026-10-12T06:00:00Z"), productId: "p1", product: "Surf Powder" };

describe("loss percent and limits", () => {
  it("rounds to one decimal, half up, and has no percent without a base", () => {
    expect(lossPercent(5, 400)).toBe("1.3");
    expect(lossPercent(30, 1080)).toBe("2.8");
    expect(lossPercent(1, 0)).toBeNull();
  });
  it("accepts limits from 0 to 100 with one decimal place", () => {
    for (const ok of ["0", "10", "10.5", "100", "100.0", " 25 "]) expect(isValidLossLimit(ok)).toBe(true);
    for (const bad of ["", "-1", "100.1", "101", "10.55", "abc", "1e2"]) expect(isValidLossLimit(bad)).toBe(false);
  });
  it("is red only strictly above the limit", () => {
    expect(isOverLimit("10.0", "10.0")).toBe(false);
    expect(isOverLimit("10.1", "10.0")).toBe(true);
    expect(isOverLimit(null, "0.0")).toBe(false);
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (p, l) =>
      isOverLimit((p / 10).toFixed(1), (l / 10).toFixed(1)) === p > l));
  });
});

describe("loss per tab", () => {
  it("costs batch loss at the batch's chemical cost per KG of target", () => {
    expect(batchLoss({ target: "500", actual: "400", chemicalCost: "150575" })).toEqual({ loss: "100.000", percent: "20.0", cost: "30115.00" });
  });
  it("costs extra chemical at its saved lot cost", () => {
    expect(chemicalLoss({ formula: "50", used: "55", extraCost: "575.00" })).toEqual({ extra: "5.000", percent: "10.0", cost: "575.00" });
  });
  it("counts powder given to packing as packed plus lost", () => {
    expect(powderLoss({ packed: "395", lost: "5", costPerUnit: "301.15" })).toEqual({ given: "400.000", percent: "1.3", cost: "1505.75" });
  });
  it("measures shopper loss and ignores negative loss in cost", () => {
    expect(shopperLoss({ expected: 1200, actual: 1080, lossCost: "62.40" })).toEqual({ loss: 120, percent: "10.0", cost: "62.40", checkWeight: false });
    expect(shopperLoss({ expected: 1000, actual: 1010, lossCost: "0.00" })).toEqual({ loss: -10, percent: "-1.0", cost: "0.00", checkWeight: true });
  });
  it("measures pieces loss against the need", () => {
    expect(piecesLoss({ needed: "1080", used: "1110", extraCost: "60.00" })).toEqual({ loss: "30.000", percent: "2.8", cost: "60.00" });
  });
  it("weights shopper loss by expected and skips check-weight rows", () => {
    expect(weightedShopperPercent([
      { expected: 1200, loss: 120, checkWeight: false },
      { expected: 800, loss: 40, checkWeight: false },
      { expected: 1000, loss: -10, checkWeight: true },
    ])).toBe("8.0"); // 160 ÷ 2,000
    expect(weightedShopperPercent([])).toBeNull();
  });
  it("adds money exactly", () => {
    expect(sumMoney(["0.10", "0.20", "30115.00"])).toBe("30115.30");
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 10_000_000 })), (paise) =>
      sumMoney(paise.map((p) => (p / 100).toFixed(2))) === (paise.reduce((a, b) => a + b, 0) / 100).toFixed(2)));
  });
});

describe("report rows", () => {
  it("builds a red batch row with the reason and note", () => {
    const row = toBatchRow({ ...runBase, target: "500", actual: "400", unit: "kg", chemicalCost: "150575", reasonCode: "spill", note: "mixer seal", formulaId: "f1", formula: "Surf 500" }, limits);
    expect([row.loss, row.percent, row.cost, row.over, row.reason, row.reasonName]).toEqual(["100.000", "20.0", "30115.00", true, 'Spill · "mixer seal"', "Spill"]);
    expect(row.link).toEqual({ kind: "run", runId: "r1" });
    expect(row.date).toBe("2026-10-12T06:00:00.000Z");
  });
  it("shows an old free-text shortfall reason as is", () => {
    const row = toBatchRow({ ...runBase, target: "500", actual: "490", unit: "kg", chemicalCost: "1000", reasonCode: null, note: "power cut", formulaId: "f1", formula: "F" }, limits);
    expect([row.reason, row.reasonCode]).toEqual(["power cut", null]);
  });
  it("names a shopper row with its KG and never marks a check-weight row red", () => {
    const base = { ...runBase, useId: "u1", materialId: "m1", material: "100g shopper", measuredInKg: true, needed: "1080.000", used: "1.200", extraQuantity: "0.000", extraCost: "62.40", reasonCode: null, note: null };
    const shopper = toPackingRow({ ...base, expectedShoppers: 1200, actualShoppers: 1080, lossShoppers: 120 }, limits);
    expect([shopper.material, shopper.needed, shopper.used, shopper.loss, shopper.percent, shopper.cost, shopper.over, shopper.reason]).toEqual(["100g shopper (1.20 KG)", "1200", "1080", "120", "10.0", "62.40", false, "Measured"]);
    const over = toPackingRow({ ...base, extraCost: "0.00", expectedShoppers: 500, actualShoppers: 700, lossShoppers: -200 }, { ...limits, shopper: "0.0" });
    expect([over.checkWeight, over.over, over.cost]).toEqual([true, false, "0.00"]);
  });
  it("uses the other-packing limit for pieces", () => {
    const row = toPackingRow({ ...runBase, useId: "u2", materialId: "m2", material: "Cap 38mm", measuredInKg: false, needed: "1080.000", used: "1110.000", extraQuantity: "30.000", extraCost: "60.00", reasonCode: "broken", note: null, expectedShoppers: null, actualShoppers: null, lossShoppers: null }, { ...limits, otherPacking: "2.5" });
    expect([row.loss, row.percent, row.over, row.reason]).toEqual(["30.000", "2.8", true, "Broken"]);
  });
  it("turns a stock removal into a positive loss with no limit", () => {
    const row = toStoreRow({ id: "a1", date: new Date("2026-10-18T05:00:00Z"), storeId: "w1", store: "Factory floor", materialType: "chemical", chemicalId: "c1", chemicalName: "Soda Ash", chemicalUnit: "kg", packagingId: null, packagingName: null, measuredInKg: null, lotPrice: "115.00", delta: "-2.000", value: "-230.00", reasonCode: "count_short", note: null, by: "Ali" }, limits);
    expect([row.material, row.unit, row.quantity, row.cost, row.reason, row.over, row.by]).toEqual(["Soda Ash", "kg", "2.000", "230.00", "Count short", false, "Ali"]);
    expect(row.link).toEqual({ kind: "item", itemType: "chemical", itemId: "c1" });
  });
});
