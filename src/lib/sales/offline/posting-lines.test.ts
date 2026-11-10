import { describe, expect, it } from "vitest";
import { buildPostingLines } from "./posting.server";

type Staged = Parameters<typeof buildPostingLines>[0][number];

function staged(patch: Partial<Staged> = {}): Staged {
  return {
    id: "item-1",
    stagedInvoiceId: "inv-1",
    worksheetRowNumber: 1,
    productCode: "P1",
    recipeId: "R1",
    cartonQuantity: 10,
    looseUnitQuantity: 6,
    packsPerCarton: 12,
    baseCartonPrice: "1000.00",
    freeCartons: 1,
    manualFreeCartons: 2,
    isPriceOverride: false,
    listedCartonPrice: null,
    chargedUnits: 126,
    dispatchedUnits: 162,
    lineAmount: "10500.00",
    wacPerPack: "80.0000",
    stockUnitsSnapshot: 500,
    physicalStockConfirmed: false,
    sourceColumns: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  } as Staged;
}

const names = new Map([["R1", "Oil 1L"]]);

describe("posting lines for desk invoices", () => {
  it("ships a distributor's free cartons on top and bills only the ordered cartons", () => {
    const { items, snapshots } = buildPostingLines([staged()], names, true);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ unitType: "carton", numberOfCartons: 10, discountCartons: 2 });
    expect(snapshots[0]).toMatchObject({
      // Only the scheme travels as free cartons; the ones given by hand are the line's discountCartons.
      freeCartons: 1,
      chargedUnits: 120,
      dispatchedUnits: (10 + 1 + 2) * 12,
      lineAmount: 10000,
    });
    expect(items[1]).toMatchObject({ unitType: "units", numberOfUnits: 6, discountCartons: 0 });
    expect(snapshots[1]).toMatchObject({ chargedUnits: 6, dispatchedUnits: 6, lineAmount: 500 });
  });

  it("bills anyone else for the ordered cartons less the free ones", () => {
    const { snapshots } = buildPostingLines([staged({ freeCartons: 0 })], names, false);
    expect(snapshots[0]).toMatchObject({
      chargedUnits: 8 * 12,
      dispatchedUnits: 10 * 12,
      lineAmount: 8000,
    });
  });

  it("adds up to the invoice total the desk calculated", () => {
    const { snapshots } = buildPostingLines([staged({ manualFreeCartons: 0, freeCartons: 0 })], names, true);
    const total = snapshots.reduce((sum, line) => sum + line.lineAmount, 0);
    expect(total).toBe(10500);
  });

  it("marks a changed price so the posted invoice keeps the flag", () => {
    const { items } = buildPostingLines([staged({ isPriceOverride: true, baseCartonPrice: "900.00" })], names, true);
    expect(items[0]).toMatchObject({ isPriceOverride: true, preserveStoredDistributorRate: false, perCartonPrice: 900 });
    const plain = buildPostingLines([staged()], names, true).items[0];
    expect(plain).toMatchObject({ isPriceOverride: false, preserveStoredDistributorRate: true });
  });
});
