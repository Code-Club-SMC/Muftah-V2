// src/lib/inventory/material-lots.test.ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Big from "big.js";
import {
  checkLotPicks, checkOldestFirst, costLotPicks, defaultLotPicks, isSimilarMaterialName, lotDateLabel, lotLabel,
  lotPrice, lotQuantity, normalizeMaterialName, oldestFirstPicks, purchaseUntouched,
} from "./material-lots";

const balances = [
  { lotId: "a", unitPrice: "115.00", quantity: "120.000", firstPurchasedAt: "2026-10-01T05:00:00Z" },
  { lotId: "b", unitPrice: "125.00", quantity: "80.000", firstPurchasedAt: "2026-10-20T05:00:00Z" },
];

describe("lotPrice", () => {
  it("rounds to the paisa, half up", () => {
    expect(lotPrice("115")).toBe("115.00");
    expect(lotPrice("115.005")).toBe("115.01");
    expect(lotPrice(new Big("114.994"))).toBe("114.99");
  });
  it("rejects negative prices", () => expect(() => lotPrice("-1")).toThrow());
});

describe("lotQuantity", () => {
  it("accepts up to three decimals", () => expect(lotQuantity("1.25")).toBe("1.250"));
  it("rejects more decimals and text", () => {
    expect(() => lotQuantity("1.2345")).toThrow();
    expect(() => lotQuantity("abc")).toThrow();
  });
});

describe("checkLotPicks", () => {
  const base = { name: "Soda Ash", unit: "kg", required: "200", balances };
  it("accepts picks that add up exactly", () => {
    expect(checkLotPicks({ ...base, picks: [{ lotId: "a", quantity: "120" }, { lotId: "b", quantity: "80" }] })).toEqual([]);
  });
  it("reports a total that does not match", () => {
    expect(checkLotPicks({ ...base, picks: [{ lotId: "a", quantity: "100" }] })).toEqual([
      "Soda Ash: lots add up to 100 kg, but 200 kg is needed",
    ]);
  });
  it("reports a pick above lot stock", () => {
    expect(checkLotPicks({ ...base, required: "130", picks: [{ lotId: "a", quantity: "130" }] })).toContain(
      "Soda Ash: Lot 1 Oct has only 120 kg here",
    );
  });
  it("reports unknown and repeated lots", () => {
    expect(checkLotPicks({ ...base, required: "10", picks: [{ lotId: "x", quantity: "10" }] })).toContain(
      "Soda Ash: one picked lot has no stock here",
    );
    expect(checkLotPicks({ ...base, required: "20", picks: [{ lotId: "a", quantity: "10" }, { lotId: "a", quantity: "10" }] })).toContain(
      "Soda Ash: pick each lot only once",
    );
  });
  it("rejects zero picks", () => {
    expect(checkLotPicks({ ...base, required: "10", picks: [{ lotId: "a", quantity: "0" }, { lotId: "b", quantity: "10" }] })).toContain(
      "Soda Ash: each picked quantity must be more than zero",
    );
  });
  it("never accepts picks whose sum differs from the requirement (property)", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 120_000 }), fc.integer({ min: 1, max: 80_000 }), fc.integer({ min: 1, max: 200_000 }), (a, b, need) => {
      const picks = [{ lotId: "a", quantity: new Big(a).div(1000).toFixed(3) }, { lotId: "b", quantity: new Big(b).div(1000).toFixed(3) }];
      const errors = checkLotPicks({ ...base, required: new Big(need).div(1000).toFixed(3), picks });
      expect(errors.length === 0).toBe(a + b === need);
    }));
  });
});

describe("costLotPicks", () => {
  it("costs each pick at its lot price", () => {
    expect(costLotPicks([{ lotId: "a", quantity: "120" }, { lotId: "b", quantity: "80" }], balances)).toEqual([
      { lotId: "a", quantity: "120.000", unitPrice: "115.00", totalCost: "13800.00" },
      { lotId: "b", quantity: "80.000", unitPrice: "125.00", totalCost: "10000.00" },
    ]);
  });
});

describe("defaultLotPicks", () => {
  it("pre-fills only when exactly one lot has stock and it covers the need", () => {
    expect(defaultLotPicks("50", [balances[0]])).toEqual([{ lotId: "a", quantity: "50.000" }]);
    expect(defaultLotPicks("50", balances)).toEqual([]);
    expect(defaultLotPicks("500", [balances[0]])).toEqual([]);
  });
});

describe("purchaseUntouched", () => {
  it("is true while the lot still holds everything bought since this purchase", () => {
    // Before: 40. Purchase +100 (balance 140). Another purchase +60 (200). Use -40 (160).
    expect(purchaseUntouched({ balanceNow: "160", movements: [
      { delta: "100", sourceType: "purchase" }, { delta: "60", sourceType: "purchase" }, { delta: "-40", sourceType: "mixing" },
    ] })).toBe(true);
  });
  it("is false once the balance dipped below the purchased quantity", () => {
    // Before: 0. Purchase +100. Use -60 (40). Transfer back +60 (100).
    expect(purchaseUntouched({ balanceNow: "100", movements: [
      { delta: "100", sourceType: "purchase" }, { delta: "-60", sourceType: "mixing" }, { delta: "60", sourceType: "transfer_in" },
    ] })).toBe(false);
  });
});

describe("similar names", () => {
  it("normalises case, spaces, dashes and dots", () => {
    expect(normalizeMaterialName(" Soda-Ash. ")).toBe("sodaash");
  });
  it("flags one-letter differences and formatting variants", () => {
    for (const name of ["Soda Ashh", "Soda-Ash", "soda  ash", "Sodo Ash"]) expect(isSimilarMaterialName("Soda Ash", name)).toBe(true);
    expect(isSimilarMaterialName("Soda Ash", "Caustic Soda")).toBe(false);
  });
});

describe("lotLabel", () => {
  it("shows price, unit and first purchase date", () => {
    expect(lotLabel(balances[0], "kg")).toBe("Rs 115/kg (first 1 Oct)");
    expect(lotLabel({ unitPrice: "2.50", firstPurchasedAt: "2026-10-20T05:00:00Z" }, "pcs")).toBe("Rs 2.50/pcs (first 20 Oct)");
  });
});

describe("oldest stock first", () => {
  const oct1 = new Date("2026-10-01");
  const oct20 = new Date("2026-10-20");
  const lots = [
    { lotId: "a", unitPrice: "115.00", quantity: "20.000", firstPurchasedAt: oct1 },
    { lotId: "b", unitPrice: "118.00", quantity: "10.000", firstPurchasedAt: oct1 },
    { lotId: "c", unitPrice: "125.00", quantity: "100.000", firstPurchasedAt: oct20 },
  ];

  it("names lots by date, never price", () => {
    expect(lots.map((lot) => lotDateLabel(lot, lots))).toEqual(["Lot 1 Oct", "Lot 1 Oct (2)", "Lot 20 Oct"]);
  });

  it("takes from the oldest lot first", () => {
    expect(oldestFirstPicks("25", lots)).toEqual([{ lotId: "a", quantity: "20.000" }, { lotId: "b", quantity: "5.000" }]);
    expect(oldestFirstPicks("15", lots)).toEqual([{ lotId: "a", quantity: "15.000" }]);
    expect(oldestFirstPicks("500", lots)).toEqual([]);
  });

  it("blocks a newer lot while an older one still has stock", () => {
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "25", picks: [{ lotId: "c", quantity: "25" }], balances: lots }))
      .toEqual(["Soda Ash: use the oldest stock first. Take 20 kg from Lot 1 Oct before a newer lot."]);
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "25", picks: [{ lotId: "a", quantity: "15" }, { lotId: "b", quantity: "10" }], balances: lots }))
      .toEqual(["Soda Ash: use the oldest stock first. Take 20 kg from Lot 1 Oct before a newer lot."]);
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "25", picks: [{ lotId: "a", quantity: "20" }, { lotId: "b", quantity: "5" }], balances: lots })).toEqual([]);
  });

  it("leaves short stock to checkLotPicks", () => {
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "500", picks: [{ lotId: "c", quantity: "100" }], balances: lots })).toEqual([]);
  });
});
