import { describe, expect, it } from "vitest";
import type { OfflineDeskEntry, OfflineDeskReference } from "./desk-pack";
import { allocatedUnitsByProduct, formatStock, lineStockWarning } from "./desk-stock";

const reference: OfflineDeskReference = {
  generatedAt: "2026-11-04T09:35:00.000Z",
  distributors: [{ id: "c1", code: "D-1", name: "Ali Traders", outstandingAmount: "0.00" }],
  retailers: [],
  products: [
    {
      recipeId: "P1",
      code: "P1",
      name: "Dishwash 200ml",
      packsPerCarton: 12,
      distributorCartonPrice: "1200.00",
      generalCartonPrice: "1500.00",
      distributorPrices: [],
      retailPricePerPack: "125.00",
      stockUnits: 100,
    },
  ],
  discountRules: [],
  orders: [],
  wallets: [],
  salesmen: [],
};

function entry(slot: number, loose: number, patch: Partial<OfflineDeskEntry> = {}): OfflineDeskEntry {
  return {
    workbookId: "wb1",
    slotNumber: slot,
    reservedSerial: slot,
    recordToken: `t${slot}`,
    invoiceNumber: `OFF-F01-20261104-${String(slot).padStart(3, "0")}`,
    invoiceAmount: 0,
    customerName: "Ali Traders",
    status: "printed",
    savedAt: "2026-11-04T09:40:00.000Z",
    printedAt: null,
    sentAt: null,
    sentBatchId: null,
    saleDate: "2026-11-04",
    saleTime: "14:40",
    saleType: "direct_distributor",
    distributorCode: "D-1",
    orderBookerCode: null,
    billNumber: null,
    paymentDueDate: null,
    remarks: null,
    items: [{ productCode: "P1", cartonQuantity: 0, looseUnitQuantity: loose, physicalStockConfirmed: false }],
    payments: [],
    ...patch,
  };
}

const NOW = new Date("2026-11-04T10:00:00Z");

describe("stock text", () => {
  it("shows cartons and loose packs", () => {
    expect(formatStock(100, 12)).toBe("8 ctn + 4 packs");
    expect(formatStock(97, 12)).toBe("8 ctn + 1 pack");
    expect(formatStock(96, 12)).toBe("8 ctn");
    expect(formatStock(5, 12)).toBe("5 packs");
    expect(formatStock(1, 12)).toBe("1 pack");
    expect(formatStock(0, 12)).toBe("0 packs");
    expect(formatStock(-3, 12)).toBe("0 packs");
    expect(formatStock(7, 1)).toBe("7 packs");
  });
});

describe("stock already promised on this computer", () => {
  it("adds up saved and printed invoices per product", () => {
    const entries = [entry(1, 11), entry(2, 11, { status: "saved" })];
    expect(allocatedUnitsByProduct(entries, reference).get("P1")).toBe(22);
  });

  it("ignores sent invoices (the office has them) and cancelled ones (the goods did not leave)", () => {
    const entries = [entry(1, 11), entry(2, 11, { status: "sent" }), entry(3, 11, { status: "cancelled" })];
    expect(allocatedUnitsByProduct(entries, reference).get("P1")).toBe(11);
  });

  it("leaves out the invoice that is being changed", () => {
    const entries = [entry(1, 11), entry(2, 11)];
    expect(allocatedUnitsByProduct(entries, reference, 2).get("P1")).toBe(11);
  });

  it("counts free cartons a distributor ships on top", () => {
    const free = entry(1, 0, {
      items: [{ productCode: "P1", cartonQuantity: 2, looseUnitQuantity: 0, manualFreeCartons: 1, physicalStockConfirmed: false }],
    });
    // 2 ordered + 1 free = 3 cartons of 12.
    expect(allocatedUnitsByProduct([free], reference).get("P1")).toBe(36);
  });
});

describe("the warning on an invoice line", () => {
  const asOf = "2026-11-04T09:35:00.000Z"; // 14:35 in Pakistan
  const base = { stockUnits: 100, allocatedUnits: 0, packsPerCarton: 12, asOf, now: NOW };

  it("warns when more is entered than exists", () => {
    expect(lineStockWarning({ ...base, dispatchedUnits: 110 })).toBe(
      "Only 8 ctn + 4 packs in stock as of 14:35. You can still save.",
    );
  });

  it("does not warn when there is enough", () => {
    expect(lineStockWarning({ ...base, dispatchedUnits: 100 })).toBeNull();
  });

  it("does not warn when the pack has no stock numbers (saved before this feature)", () => {
    expect(lineStockWarning({ ...base, stockUnits: undefined, dispatchedUnits: 999 })).toBeNull();
  });

  it("shows the shortage on the tenth invoice of 11 packs, after nine others took 99", () => {
    const others = Array.from({ length: 9 }, (_, index) => entry(index + 1, 11));
    const allocated = allocatedUnitsByProduct(others, reference).get("P1") ?? 0;
    expect(allocated).toBe(99);
    expect(lineStockWarning({ ...base, allocatedUnits: allocated, dispatchedUnits: 11 })).toBe(
      "Only 1 pack in stock as of 14:35 (8 ctn + 3 packs already on other unsent invoices). You can still save.",
    );
  });
});
