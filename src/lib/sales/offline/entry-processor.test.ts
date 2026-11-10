import { describe, expect, it } from "vitest";
import type { OfflineSalesManifest, OfflineSalesReferenceSnapshot } from "./contracts";
import type { OfflineEntry } from "./entry-calculator";
import { buildParsedWorkbookFromEntries, fingerprintOfflineEntries } from "./entry-processor.server";

const snapshot: OfflineSalesReferenceSnapshot = {
  generatedAt: "2026-11-01T00:00:00.000Z",
  factoryWarehouseId: "wh",
  distributors: [
    { id: "c1", code: "D-1", name: "Ali Traders", outstandingAmount: "0.00", creditLimit: "0.00", creditHold: false, address: null, city: null, mobile: null },
  ],
  products: [
    {
      recipeId: "P1",
      productId: "prod",
      code: "P1",
      name: "Oil 1L",
      packsPerCarton: 12,
      distributorCartonPrice: "1200.00",
      generalCartonPrice: "1500.00",
      distributorPrices: [{ customerId: "c1", cartonPrice: "1000.00" }],
      retailPricePerPack: "120.00",
      wacPerPack: "80.0000",
      stockUnits: 500,
    },
  ],
  retailers: [],
  salesmen: [],
  discountRules: [],
  orders: [],
  wallets: [
    { id: "w1", code: "W-CASH", name: "Cash", type: "cash" },
    { id: "w2", code: "W-BANK", name: "Bank", type: "bank" },
  ],
};

const manifest: OfflineSalesManifest = {
  format: "titan-offline-sales",
  workbookId: "wb1",
  factoryCode: "F01",
  operatorUserId: "u1",
  templateVersion: 1,
  signingVersion: 1,
  invoiceCapacity: 500,
  itemCapacity: 10_000,
  paymentCapacity: 2_000,
  issuedAt: "2026-11-01T00:00:00.000Z",
  snapshotSha256: "hash",
};

const slots = [
  { slotNumber: 1, reservedSerial: 101, recordToken: "t1" },
  { slotNumber: 2, reservedSerial: 102, recordToken: "t2" },
];

function entry(slotNumber: number, token: string, patch: Partial<OfflineEntry> = {}): OfflineEntry {
  return {
    slotNumber,
    recordToken: token,
    saleDate: "2026-11-03",
    saleTime: "09:00",
    saleType: "direct_distributor",
    distributorCode: "D-1",
    orderBookerCode: null,
    billNumber: null,
    paymentDueDate: "2026-11-30",
    remarks: null,
    items: [{ productCode: "P1", cartonQuantity: 2, looseUnitQuantity: 0, physicalStockConfirmed: false }],
    payments: [],
    ...patch,
  };
}

const build = (entries: OfflineEntry[]) =>
  buildParsedWorkbookFromEntries({
    manifest,
    manifestSignature: "sig",
    snapshot,
    snapshotSignature: "sig",
    slots,
    entries,
  });

describe("offline entry processor", () => {
  it("prices every invoice from the server snapshot", () => {
    const parsed = build([entry(1, "t1")]);
    const [invoice] = parsed.invoices;
    expect(invoice.invoiceNumber).toBe("OFF-F01-20261103-101");
    expect(invoice.invoiceAmount).toBe(2000);
    expect(invoice.items[0]).toMatchObject({ baseCartonPrice: 1000, wacPerPack: 80, stockUnitsSnapshot: 500, worksheetRowNumber: 1 });
    expect(invoice.parseIssues).toEqual([]);
    expect(invoice.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a slot or token the server never issued", () => {
    expect(() => build([entry(1, "forged")])).toThrow("was not issued by the system");
    expect(() => build([entry(9, "t1")])).toThrow("was not issued by the system");
  });

  it("refuses the same slot twice", () => {
    expect(() => build([entry(1, "t1"), entry(1, "t1")])).toThrow("appears more than once");
  });

  it("keeps invalid invoices so the office can see the problem", () => {
    const parsed = build([entry(2, "t2", { distributorCode: "D-404" })]);
    expect(parsed.invoices[0].parseIssues.map((value) => value.code)).toContain("unknown_distributor");
  });

  it("gives the same fingerprint for the same invoices in any order", () => {
    const a = entry(1, "t1");
    const b = entry(2, "t2");
    expect(fingerprintOfflineEntries("wb1", [a, b])).toBe(fingerprintOfflineEntries("wb1", [b, a]));
    expect(fingerprintOfflineEntries("wb1", [a])).not.toBe(fingerprintOfflineEntries("wb1", [a, b]));
    expect(fingerprintOfflineEntries("wb1", [a])).not.toBe(fingerprintOfflineEntries("wb2", [a]));
  });

  it("changes the content hash when anything the customer paid for changes", () => {
    const first = build([entry(1, "t1")]).invoices[0].contentHash;
    const second = build([
      entry(1, "t1", { items: [{ productCode: "P1", cartonQuantity: 3, looseUnitQuantity: 0, physicalStockConfirmed: false }] }),
    ]).invoices[0].contentHash;
    expect(first).not.toBe(second);
  });

  it("carries a walk-in customer, discount and freight onto the parsed invoice", () => {
    const retailSnapshot = snapshot;
    const parsed = buildParsedWorkbookFromEntries({
      manifest,
      manifestSignature: "sig",
      snapshot: retailSnapshot,
      snapshotSignature: "sig",
      slots,
      entries: [
        entry(1, "t1", {
          saleType: "direct_retailer",
          distributorCode: null,
          newCustomer: { name: "Bilal Store", mobile: "0300", city: "Lahore", address: null },
          invoiceDiscount: 100,
          expenses: 50,
          expensesDescription: "Loading",
        }),
      ],
    });
    const [invoice] = parsed.invoices;
    expect(invoice.parseIssues).toEqual([]);
    expect(invoice.customerDetails).toEqual({ name: "Bilal Store", mobile: "0300", city: "Lahore", address: null });
    // 2 cartons x 1500 = 3000, minus 100 discount, plus 50 freight.
    expect([invoice.invoiceAmount, invoice.invoiceDiscount, invoice.expenses]).toEqual([2950, 100, 50]);
  });

  it("marks a cancelled invoice so staging excludes it", () => {
    const parsed = build([entry(1, "t1", { cancelled: { reason: "Wrong customer", at: "2026-11-03T05:00:00.000Z" } })]);
    expect(parsed.invoices[0].cancelledReason).toBe("Wrong customer");
  });

  it("carries payment notes and instant verification", () => {
    const parsed = build([
      entry(1, "t1", {
        paymentDueDate: null,
        payments: [
          {
            method: "bank_transfer",
            amount: 2000,
            walletCode: "W-BANK",
            reference: "TX9",
            chequeBank: null,
            chequeNumber: null,
            chequeDate: null,
            paymentDate: "2026-11-03",
            instantVerify: true,
            bank: { senderBankName: "HBL", senderAccountNumber: "123" },
          },
        ],
      }),
    ]);
    expect(parsed.invoices[0].parseIssues).toEqual([]);
    expect(parsed.invoices[0].payments[0]).toMatchObject({ notes: "From: HBL (A/C: 123)", instantVerify: true });
    expect(parsed.invoices[0].paidAmount).toBe(2000);
  });

  it("carries manual free cartons, a changed price and a salary offset onto the parsed invoice", () => {
    const withSalesman = { ...snapshot, salesmen: [{ employeeId: "emp-1", name: "Imran" }] };
    const parsed = buildParsedWorkbookFromEntries({
      manifest,
      manifestSignature: "sig",
      snapshot: withSalesman,
      snapshotSignature: "sig",
      slots,
      entries: [
        entry(1, "t1", {
          paymentDueDate: null,
          items: [
            { productCode: "P1", cartonQuantity: 2, looseUnitQuantity: 0, physicalStockConfirmed: false, manualFreeCartons: 1, priceOverride: 900 },
          ],
          payments: [
            { method: "expense_offset", amount: 1800, walletCode: "", expenseEmployeeId: "emp-1", reference: null, chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03" },
          ],
        }),
      ],
    });
    const [invoice] = parsed.invoices;
    expect(invoice.parseIssues).toEqual([]);
    expect(invoice.items[0]).toMatchObject({ manualFreeCartons: 1, isPriceOverride: true, listedCartonPrice: 1000, baseCartonPrice: 900 });
    expect(invoice.payments[0]).toMatchObject({ method: "expense_offset", expenseType: "salesman_salary", expenseEmployeeId: "emp-1" });
    // The distributor is shipped 3 cartons and billed for the 2 ordered at 900.
    expect(invoice.items[0].dispatchedUnits).toBe(3 * 12);
    expect([invoice.invoiceAmount, invoice.paidAmount, invoice.outstandingAmount]).toEqual([1800, 1800, 0]);
  });

  it("keeps the printed total so the office can compare it", () => {
    const parsed = build([entry(1, "t1", { printedTotal: 1234.5 })]);
    expect(parsed.invoices[0].printedTotal).toBe(1234.5);
    expect(parsed.invoices[0].invoiceAmount).toBe(2000);
    expect(build([entry(1, "t1")]).invoices[0].printedTotal).toBeNull();
  });
});
