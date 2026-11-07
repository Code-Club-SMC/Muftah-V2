import { describe, expect, it } from "vitest";
import type { OfflineSalesReferenceSnapshot } from "./contracts";
import { toDeskReference } from "./desk-pack";

describe("what the server sends to the desk", () => {
  it("includes stock on hand but keeps the cost price on the server", () => {
    const snapshot = {
      generatedAt: "2026-11-04T09:35:00.000Z",
      distributors: [],
      retailers: [],
      products: [
        {
          recipeId: "R1",
          productId: "P1",
          code: "P1",
          name: "Dishwash 200ml",
          packsPerCarton: 12,
          distributorCartonPrice: "1200.00",
          distributorPrices: [],
          retailPricePerPack: "125.00",
          generalCartonPrice: "1500.00",
          wacPerPack: "80.0000",
          stockUnits: 100,
        },
      ],
      discountRules: [],
      orders: [],
      wallets: [],
      salesmen: [],
    } as unknown as OfflineSalesReferenceSnapshot;

    const [product] = toDeskReference(snapshot).products;
    expect(product.stockUnits).toBe(100);
    expect(product).not.toHaveProperty("wacPerPack");
  });
});
