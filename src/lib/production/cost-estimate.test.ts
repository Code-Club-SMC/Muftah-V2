import { describe, expect, it } from "vitest";
import { estimateFormat, ingredientsCost, packagingPieceCost } from "./cost-estimate";

const format = {
  batchSize: "100", batchUnit: "kg", targetUnitsPerBatch: 1, fillAmount: "1", fillUnit: "kg", containersPerCarton: 10,
  formula: { batchSize: "100", batchUnit: "kg", ingredients: [{ quantityPerBatch: "12", chemical: { costPerUnit: "175" } }] },
  ingredients: [],
  containerPackaging: { costPerUnit: "2" },
  cartonPackaging: { costPerUnit: "50" },
  packaging: [
    { quantityPerContainer: "1", usageBasis: "per_unit", packagingMaterial: { costPerUnit: "0.50" } },
    { quantityPerContainer: "2", usageBasis: "per_carton", packagingMaterial: { costPerUnit: "5" } },
  ],
};

describe("format cost estimate", () => {
  it("adds formula, pack, carton and extras at the prices given", () => {
    expect(estimateFormat(format)).toEqual({
      estimatedIngredientsCost: "2100.00", // 12 kg x 175
      estimatedPackagingCost: "850.00", // 100x2 + 10x50 + 100x0.50 + 20x5
      estimatedCostPerBatch: "2950.00",
      estimatedCostPerContainer: "29.5000",
    });
  });

  it("follows ingredients being added, changed and removed", () => {
    const cost = (ingredients: typeof format.formula.ingredients) =>
      estimateFormat({ ...format, formula: { ...format.formula, ingredients } }).estimatedIngredientsCost;
    const [soda] = format.formula.ingredients;
    expect(cost([soda, { quantityPerBatch: "1", chemical: { costPerUnit: "100" } }])).toBe("2200.00");
    expect(cost([{ ...soda, quantityPerBatch: "6" }])).toBe("1050.00");
    expect(cost([])).toBe("0.00");
  });

  it("uses the formula's batch size, not the one saved on the format", () => {
    expect(estimateFormat({ ...format, batchSize: "999", formula: { ...format.formula, batchSize: "50" } }).estimatedCostPerContainer)
      .toBe("50.5000"); // (2100 + 50x2 + 5x50 + 50x0.50 + 10x5) / 50
  });

  it("costs a KG shopper by its weight", () => {
    expect(packagingPieceCost({ costPerUnit: "600", measuredInKg: true, weightPerPack: "6" }).toString()).toBe("3.6");
    expect(packagingPieceCost({ costPerUnit: "600", measuredInKg: false, weightPerPack: "6" }).toString()).toBe("600");
  });

  it("has no pack cost when a pack is bigger than the batch", () => {
    expect(estimateFormat({ ...format, fillAmount: "200" }).estimatedCostPerContainer).toBeNull();
  });

  it("keeps formats without a formula on their own ingredients and target", () => {
    expect(estimateFormat({ ...format, formula: null, fillAmount: null, targetUnitsPerBatch: 10, ingredients: [{ quantityPerBatch: "1", chemical: { costPerUnit: "100" } }] }).estimatedIngredientsCost).toBe("100.00");
  });

  it("treats a missing price as zero", () => {
    expect(ingredientsCost([{ quantityPerBatch: "5", chemical: { costPerUnit: null } }, { quantityPerBatch: "5", chemical: null }]).toString()).toBe("0");
  });
});
