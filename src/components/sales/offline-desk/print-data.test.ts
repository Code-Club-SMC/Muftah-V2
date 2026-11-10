import { describe, expect, it } from "vitest";
import type { OfflineDeskEntry, OfflineDeskPack } from "@/lib/sales/offline/desk-pack";
import { buildOfflinePrintData, previousBalanceFor } from "./print-data";

const pack: OfflineDeskPack = {
  workbookId: "wb1",
  operatorName: "Operator",
  issuedAt: "2026-11-01T00:00:00.000Z",
  invoiceCapacity: 500,
  slots: [],
  reference: {
    generatedAt: "2026-11-01T00:00:00.000Z",
    distributors: [
      { id: "c1", code: "D-1", name: "Ali Traders", address: "Main Road", city: "Lahore", mobile: "0300", outstandingAmount: "5000.00" },
    ],
    retailers: [
      { id: "r1", code: "C-7", name: "Bilal Store", customerType: "retailer", mobile: "0311", city: "Multan", address: "Chowk", outstandingAmount: "200.00" },
    ],
    products: [
      {
        recipeId: "P1",
        code: "P1",
        name: "Oil 1L",
        packsPerCarton: 12,
        distributorCartonPrice: "1200.00",
        generalCartonPrice: "1500.00",
        distributorPrices: [],
        retailPricePerPack: "120.00",
      },
    ],
    discountRules: [],
    orders: [],
    wallets: [{ id: "w1", code: "W-CASH", name: "Cash", type: "cash" }],
    salesmen: [],
  },
};

function entry(serial: number, patch: Partial<OfflineDeskEntry> = {}): OfflineDeskEntry {
  return {
    workbookId: "wb1",
    slotNumber: serial,
    reservedSerial: serial,
    recordToken: `t${serial}`,
    invoiceNumber: `OFF-F01-20261103-${String(serial).padStart(3, "0")}`,
    invoiceAmount: 0,
    customerName: "Ali Traders",
    status: "printed",
    savedAt: "2026-11-03T05:00:00.000Z",
    printedAt: "2026-11-03T05:01:00.000Z",
    sentAt: null,
    sentBatchId: null,
    saleDate: "2026-11-03",
    saleTime: "10:00",
    saleType: "direct_distributor",
    distributorCode: "D-1",
    orderBookerCode: null,
    billNumber: null,
    paymentDueDate: "2026-11-30",
    remarks: null,
    items: [{ productCode: "P1", cartonQuantity: 2, looseUnitQuantity: 3, physicalStockConfirmed: false }],
    payments: [],
    ...patch,
  };
}

describe("offline invoice print data", () => {
  it("uses the distributor layout for a distributor, with previous balance and freight", () => {
    const sale = entry(1, { expenses: 100 });
    const printed = buildOfflinePrintData(sale, pack, [sale]);
    expect(printed.kind).toBe("distributor");
    if (printed.kind !== "distributor") return;
    expect(printed.data.party).toMatchObject({ name: "Ali Traders", address: "Main Road", city: "Lahore", tel: "0300" });
    expect(printed.data.estNo).toBe("OFF-F01-20261103-001");
    expect(printed.data.date).toBe("03-Nov-2026");
    expect(printed.data.items[0]).toMatchObject({ cartonQty: "2-3", schemeCarton: "0-0", cartonRate: 1200, netAmount: 2700 });
    expect(printed.data.freight).toBe(100);
    // 2 cartons x 1200 + 3 loose packs x 100 = 2700, plus 100 freight.
    expect(printed.data.invoiceAmount).toBe(2800);
    expect(printed.data.previousBalance).toBe(5000);
  });

  it("uses the general layout for a retailer and for a new walk-in", () => {
    const sale = entry(2, { saleType: "direct_retailer", distributorCode: "C-7" });
    const printed = buildOfflinePrintData(sale, pack, [sale]);
    expect(printed.kind).toBe("general");
    if (printed.kind !== "general") return;
    expect(printed.data.customer).toMatchObject({ name: "Bilal Store", phoneNumber: "0311" });
    expect(printed.data.items[0]).toMatchObject({ rate: 1500, qty: "2 Cartons (24 Packs) + 3 Packs" });

    const walkIn = entry(3, {
      saleType: "direct_retailer",
      distributorCode: null,
      newCustomer: { name: "New Shop", mobile: "0322", city: "Kasur", address: "Bazaar" },
    });
    const walkInPrint = buildOfflinePrintData(walkIn, pack, [walkIn]);
    expect(walkInPrint.kind).toBe("general");
    if (walkInPrint.kind !== "general") return;
    expect(walkInPrint.data.customer).toMatchObject({ name: "New Shop", completeAddress: "Bazaar, Kasur", phoneNumber: "0322" });
  });

  it("adds what earlier desk invoices to the same customer left unpaid", () => {
    const first = entry(1);
    const second = entry(2, { saleDate: "2026-11-04" });
    const cancelled = entry(3, { status: "cancelled" });
    const third = entry(4);
    const all = [first, second, cancelled, third];
    // Opening 5000, plus 2700 left unpaid on each of the two earlier real invoices.
    expect(previousBalanceFor(third, pack, all)).toBe(10400);
    expect(previousBalanceFor(first, pack, all)).toBe(5000);
  });
});
