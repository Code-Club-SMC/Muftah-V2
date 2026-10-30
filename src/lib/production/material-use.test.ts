import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Big from "big.js";
import {
  ADJUSTMENT_REASONS, MIXING_REASONS, PACKING_REASONS, POWDER_LOSS_REASONS,
  adjustmentReasonsFor, checkAdjustmentReason, checkPiecesUse, checkReason, groupFormulaUse,
  mixingUseChange, reasonCodes, reasonLabel, shopperNumbers,
} from "./material-use";
import { packagingUnit } from "@/lib/inventory/material-units";

describe("reason lists", () => {
  it("match the spec", () => {
    expect(MIXING_REASONS.map((r) => r.label)).toEqual(["Spill", "Leak", "Measuring error", "Machine fault", "Moisture loss", "Other"]);
    expect(PACKING_REASONS.map((r) => r.label)).toEqual(["Broken", "Torn", "Misprint", "Machine fault", "Other"]);
    expect(POWDER_LOSS_REASONS.map((r) => r.label)).toEqual(["Spill", "Machine fault", "Stuck in machine", "Other"]);
    expect(ADJUSTMENT_REASONS.map((r) => r.label)).toEqual(["Damaged", "Spilled", "Expired", "Count short", "Count over", "Other"]);
    expect(reasonCodes(MIXING_REASONS)[0]).toBe("spill");
    expect(reasonLabel(PACKING_REASONS, "misprint")).toBe("Misprint");
  });

  it("requires a listed code, and a note for Other", () => {
    expect(checkReason(MIXING_REASONS, undefined, "", "extra Soda Ash")).toBe("Pick a reason for extra Soda Ash");
    expect(checkReason(MIXING_REASONS, "typo", "", "extra Soda Ash")).toBe("Pick a reason from the list for extra Soda Ash");
    expect(checkReason(MIXING_REASONS, "other", " ", "extra Soda Ash")).toBe('Write a note for "Other" on extra Soda Ash');
    expect(checkReason(MIXING_REASONS, "other", "pump", "extra Soda Ash")).toBeNull();
    expect(checkReason(MIXING_REASONS, "spill", "", "extra Soda Ash")).toBeNull();
  });

  it("only lets additions use Count over or Other", () => {
    expect(adjustmentReasonsFor(true).map((r) => r.code)).toEqual(["count_over", "other"]);
    expect(adjustmentReasonsFor(false).map((r) => r.code)).toEqual(["damaged", "spilled", "expired", "count_short", "other"]);
    expect(checkAdjustmentReason("damaged", "", true)).toBe("Damaged can't be used when adding stock");
    expect(checkAdjustmentReason("count_over", "", false)).toBe("Count over can't be used when removing stock");
    expect(checkAdjustmentReason("count_short", "", false)).toBeNull();
  });
});

describe("mixing use", () => {
  it("finds extra and leftover", () => {
    expect(mixingUseChange("50", "55")).toEqual({ kind: "extra", quantity: "5.000" });
    expect(mixingUseChange("20", "18")).toEqual({ kind: "leftover", quantity: "2.000" });
    expect(mixingUseChange("30", "30.000")).toEqual({ kind: "same", quantity: "0.000" });
    expect(() => mixingUseChange("30", "-1")).toThrow();
  });

  it("formula plus change is always the used amount", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_999_999 }), fc.integer({ min: 0, max: 9_999_999 }), (f, u) => {
      const formula = new Big(f).div(1000).toFixed(3);
      const used = new Big(u).div(1000).toFixed(3);
      const change = mixingUseChange(formula, used);
      const signed = change.kind === "leftover" ? new Big(change.quantity).times(-1) : new Big(change.quantity);
      return new Big(formula).plus(signed).eq(used);
    }));
  });

  it("groups a batch's formula lots per chemical", () => {
    const at = new Date("2026-10-01");
    const grouped = groupFormulaUse([
      { chemicalId: "soda", lotId: "a", quantity: "30.000", unitPrice: "115.00", firstPurchasedAt: at },
      { chemicalId: "soda", lotId: "b", quantity: "20.000", unitPrice: "125.00", firstPurchasedAt: at },
      { chemicalId: "labsa", lotId: "c", quantity: "30.000", unitPrice: "200.00", firstPurchasedAt: at },
    ]);
    expect(grouped.get("soda")).toEqual({ formula: "50.000", takenLots: [
      { lotId: "a", quantity: "30.000", unitPrice: "115.00", firstPurchasedAt: at },
      { lotId: "b", quantity: "20.000", unitPrice: "125.00", firstPurchasedAt: at },
    ] });
    expect(grouped.get("labsa")?.formula).toBe("30.000");
  });
});

describe("packing use", () => {
  it("blocks pieces below needed and asks a reason above needed", () => {
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1000" })).toEqual(["Cap 38mm: used can't be less than needed (1080). Check the pack count instead."]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1110" })).toEqual(["Pick a reason for extra Cap 38mm"]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1110", reason: "broken" })).toEqual([]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1080" })).toEqual([]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "abc" })).toEqual(["Cap 38mm: enter the quantity used as a number with up to 3 decimals"]);
  });

  it("works out shoppers from KG", () => {
    expect(shopperNumbers({ kgUsed: "1.20", gramsPerShopper: "1.0", actualPacks: 1080 }))
      .toEqual({ expected: 1200, actual: 1080, loss: 120, lossPercent: "10.0", moreThanExpected: false });
    expect(shopperNumbers({ kgUsed: "1.00", gramsPerShopper: "1.0", actualPacks: 1010 }))
      .toEqual({ expected: 1000, actual: 1010, loss: -10, lossPercent: "-1.0", moreThanExpected: true });
    expect(shopperNumbers({ kgUsed: "1", gramsPerShopper: "1.5", actualPacks: 600 }).expected).toBe(666);
    expect(() => shopperNumbers({ kgUsed: "1", gramsPerShopper: "0", actualPacks: 1 })).toThrow("Set the weight of one shopper in material setup");
    expect(() => shopperNumbers({ kgUsed: "0", gramsPerShopper: "1", actualPacks: 1 })).toThrow("Enter the KG of shopper used");
  });

  it("loss is always expected minus actual", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 100, max: 50_000 }), fc.integer({ min: 0, max: 200_000 }), (kgGrams, mg, actual) => {
      const result = shopperNumbers({ kgUsed: new Big(kgGrams).div(1000).toFixed(3), gramsPerShopper: new Big(mg).div(1000).toFixed(3), actualPacks: actual });
      return result.loss === result.expected - actual && result.moreThanExpected === result.loss < 0;
    }));
  });

  it("names the unit", () => {
    expect(packagingUnit({ measuredInKg: true })).toBe("kg");
    expect(packagingUnit({ measuredInKg: false })).toBe("pcs");
    expect(packagingUnit(null)).toBe("pcs");
  });
});
