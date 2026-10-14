import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/authz.server";
import { loadMixingStockRequirements } from "@/lib/production/mixing-stock.server";

function transaction(ingredients: unknown[], stocks: unknown[]) {
  const answers = [ingredients, stocks];
  const select = vi.fn(() => {
    const result = answers.shift();
    const query: any = {
      from: () => query,
      leftJoin: () => query,
      where: () => query,
      orderBy: () => query,
      for: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return query;
  });
  return { select } as unknown as Tx;
}

describe("mixing stock validation", () => {
  it("reports every shortage with material names, units and exact missing quantities", async () => {
    const tx = transaction(
      [
        {
          chemicalId: "acid",
          name: "Citric acid",
          unit: "kg",
          quantity: "1.100",
          costPerUnit: "5",
        },
        {
          chemicalId: "acid",
          name: "Citric acid",
          unit: "kg",
          quantity: "2.200",
          costPerUnit: "5",
        },
        {
          chemicalId: "water",
          name: "Water",
          unit: "liters",
          quantity: "10.000",
          costPerUnit: "1",
        },
      ],
      [{ chemicalId: "acid", quantity: "1.200" }],
    );
    const result = await loadMixingStockRequirements(tx, "formula", "floor");
    expect(result.shortages).toEqual([
      {
        chemicalId: "acid",
        name: "Citric acid",
        unit: "kg",
        required: "3.300",
        available: "1.200",
        missing: "2.100",
      },
      {
        chemicalId: "water",
        name: "Water",
        unit: "liters",
        required: "10.000",
        available: "0.000",
        missing: "10.000",
      },
    ]);
    expect(result.materials).toHaveLength(2);
  });

  it("accepts an exact stock match without consuming stock", async () => {
    const result = await loadMixingStockRequirements(
      transaction(
        [
          {
            chemicalId: "acid",
            name: "Acid",
            unit: "kg",
            quantity: "0.300",
            costPerUnit: "5",
          },
        ],
        [{ chemicalId: "acid", quantity: "0.300" }],
      ),
      "formula",
      "floor",
    );
    expect(result.shortages).toEqual([]);
    expect(result.materials[0].quantity).toBe("0.300");
  });

  it.each(["0", "-1", "NaN"])(
    "rejects invalid formula quantity %s",
    async (quantity) => {
      await expect(
        loadMixingStockRequirements(
          transaction(
            [
              {
                chemicalId: "acid",
                name: "Acid",
                unit: "kg",
                quantity,
                costPerUnit: "5",
              },
            ],
            [],
          ),
          "formula",
          "floor",
        ),
      ).rejects.toThrow("Invalid quantity");
    },
  );

  it("rejects a formula without ingredients", async () => {
    await expect(
      loadMixingStockRequirements(transaction([], []), "formula", "floor"),
    ).rejects.toThrow("no chemical ingredients");
  });
});
