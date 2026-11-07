import { describe, expect, it } from "vitest";
import {
  bookedOrderItems,
  calculateOfflineEntry,
  formatOfflineInvoiceNumber,
  paymentNotes,
  type OfflineCalcReference,
  type OfflineEntry,
} from "./entry-calculator";

const reference: OfflineCalcReference = {
  generatedAt: "2026-11-01T00:00:00.000Z",
  distributors: [{ id: "c1", code: "D-1" }],
  retailers: [
    { id: "r1", code: "C-7", customerType: "retailer" },
    { id: "r2", code: "C-8", customerType: "shopkeeper" },
  ],
  products: [
    {
      recipeId: "P1",
      code: "P1",
      packsPerCarton: 12,
      distributorCartonPrice: "1200.00",
      generalCartonPrice: "1500.00",
      distributorPrices: [{ customerId: "c1", cartonPrice: "1000.00" }],
    },
  ],
  discountRules: [
    {
      id: "r1",
      customerId: "c1",
      recipeId: "P1",
      quantityThreshold: 10,
      freeCartons: 1,
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveTo: null,
    },
  ],
  orders: [
    {
      orderBookerCode: "B1",
      billNumber: 55,
      items: [{ productCode: "P1", unitType: "full_carton", quantity: 2, cartonRate: "900.00" }],
    },
  ],
  wallets: [
    { code: "W-CASH", type: "cash" },
    { code: "W-BANK", type: "bank" },
  ],
  salesmen: [{ employeeId: "emp-1", name: "Imran" }],
};

function direct(patch: Partial<OfflineEntry> = {}): OfflineEntry {
  return {
    slotNumber: 1,
    recordToken: "token",
    saleDate: "2026-11-03",
    saleTime: "10:30",
    saleType: "direct_distributor",
    distributorCode: "D-1",
    orderBookerCode: null,
    billNumber: null,
    paymentDueDate: "2026-11-30",
    remarks: null,
    items: [{ productCode: "P1", cartonQuantity: 10, looseUnitQuantity: 6, physicalStockConfirmed: false }],
    payments: [],
    ...patch,
  };
}

describe("offline entry calculator", () => {
  it("builds the invoice number from the date and reserved serial", () => {
    expect(formatOfflineInvoiceNumber("2026-11-03", 7)).toBe("OFF-F01-20261103-007");
    expect(formatOfflineInvoiceNumber("2026-11-03", 1234)).toBe("OFF-F01-20261103-1234");
    expect(formatOfflineInvoiceNumber("nope", 7)).toBe("OFF-F01-INVALID-007");
  });

  it("prices a distributor sale with its own rate and free cartons", () => {
    const result = calculateOfflineEntry(direct(), reference, 7);
    expect(result.issues).toEqual([]);
    expect(result.invoiceNumber).toBe("OFF-F01-20261103-007");
    expect(result.items[0]).toMatchObject({
      baseCartonPrice: 1000,
      freeCartons: 1,
      chargedUnits: 126,
      dispatchedUnits: 138,
      lineAmount: 10500,
    });
    expect(result.invoiceAmount).toBe(10500);
    expect(result.outstandingAmount).toBe(10500);
  });

  it("falls back to the default carton price when the distributor has no own rate", () => {
    const other: OfflineCalcReference = {
      ...reference,
      products: [{ ...reference.products[0], distributorPrices: [] }],
      discountRules: [],
    };
    const result = calculateOfflineEntry(direct(), other, 7);
    expect(result.items[0].baseCartonPrice).toBe(1200);
    expect(result.items[0].freeCartons).toBe(0);
    expect(result.invoiceAmount).toBe(12600);
  });

  it("splits money into cash, pending and outstanding", () => {
    const result = calculateOfflineEntry(
      direct({
        payments: [
          { method: "cash", amount: 4000, walletCode: "W-CASH", reference: null, chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03" },
          { method: "bank_transfer", amount: 3000, walletCode: "W-BANK", reference: "TX1", chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03", bank: { senderBankName: "HBL", senderAccountNumber: "123" } },
        ],
      }),
      reference,
      7,
    );
    expect(result.issues).toEqual([]);
    expect([result.paidAmount, result.pendingAmount, result.outstandingAmount]).toEqual([4000, 3000, 6500]);
  });

  it("flags payments above the invoice and a missing due date", () => {
    const result = calculateOfflineEntry(
      direct({
        paymentDueDate: null,
        payments: [
          { method: "cash", amount: 20000, walletCode: "W-CASH", reference: null, chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03" },
        ],
      }),
      reference,
      7,
    );
    expect(result.issues.map((value) => value.code)).toContain("payments_exceed_invoice");
    const unpaid = calculateOfflineEntry(direct({ paymentDueDate: null }), reference, 7);
    expect(unpaid.issues.map((value) => value.code)).toEqual(["missing_due_date"]);
  });

  it("rejects wrong wallet type, missing cheque details and bad quantities", () => {
    const result = calculateOfflineEntry(
      direct({
        items: [{ productCode: "P1", cartonQuantity: -1, looseUnitQuantity: 0, physicalStockConfirmed: false }],
        payments: [
          { method: "cash", amount: 100, walletCode: "W-BANK", reference: null, chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03" },
          { method: "cheque", amount: 100, walletCode: "W-BANK", reference: null, chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03" },
        ],
      }),
      reference,
      7,
    );
    const codes = result.issues.map((value) => value.code);
    expect(codes).toEqual(expect.arrayContaining(["invalid_cartons", "invalid_payment_wallet", "missing_cheque_details"]));
  });

  it("uses the saved order rate for a booked order and requires exact quantities", () => {
    const booked = (cartons: number): OfflineEntry =>
      direct({
        saleType: "booked_order",
        distributorCode: null,
        orderBookerCode: "B1",
        billNumber: 55,
        items: [{ productCode: "P1", cartonQuantity: cartons, looseUnitQuantity: 0, physicalStockConfirmed: false }],
      });
    const exact = calculateOfflineEntry(booked(2), reference, 8);
    expect(exact.issues).toEqual([]);
    expect(exact.items[0]).toMatchObject({ baseCartonPrice: 900, freeCartons: 0, lineAmount: 1800 });
    const wrong = calculateOfflineEntry(booked(1), reference, 8);
    expect(wrong.issues.map((value) => value.code)).toContain("booked_order_quantity_mismatch");
  });

  it("turns a booked order into cartons and loose packs", () => {
    const items = bookedOrderItems(
      {
        orderBookerCode: "B1",
        billNumber: 1,
        items: [
          { productCode: "P1", unitType: "half_carton", quantity: 3, cartonRate: "900.00" },
          { productCode: "P1", unitType: "unit", quantity: 1, cartonRate: "900.00" },
        ],
      },
      reference.products,
    );
    // 3 half cartons = 18 packs, plus 1 pack = 19 packs = 1 carton + 7 loose.
    expect(items).toEqual([{ productCode: "P1", cartonQuantity: 1, looseUnitQuantity: 7, physicalStockConfirmed: false }]);
  });

  it("rejects duplicate products and unknown distributors", () => {
    const item = { productCode: "P1", cartonQuantity: 1, looseUnitQuantity: 0, physicalStockConfirmed: false };
    const result = calculateOfflineEntry(direct({ distributorCode: "D-9", items: [item, item] }), reference, 7);
    const codes = result.issues.map((value) => value.code);
    expect(codes).toEqual(expect.arrayContaining(["duplicate_product", "unknown_distributor"]));
  });

  describe("retailers and walk-in customers", () => {
    const retail = (patch: Partial<OfflineEntry> = {}): OfflineEntry =>
      direct({ saleType: "direct_retailer", distributorCode: "C-7", ...patch });

    it("prices an existing retailer at the general rate with no free cartons", () => {
      const result = calculateOfflineEntry(retail(), reference, 9);
      expect(result.issues.map((value) => value.code)).toEqual([]);
      expect(result.items[0]).toMatchObject({ baseCartonPrice: 1500, freeCartons: 0, lineAmount: 15750 });
    });

    it("accepts a new walk-in customer by name and rejects a missing one", () => {
      const walkIn = retail({
        distributorCode: null,
        newCustomer: { name: "Bilal Store", mobile: "0300", city: null, address: null },
      });
      expect(calculateOfflineEntry(walkIn, reference, 9).issues).toEqual([]);
      const nameless = retail({ distributorCode: null, newCustomer: { name: " ", mobile: null, city: null, address: null } });
      expect(calculateOfflineEntry(nameless, reference, 9).issues.map((value) => value.code)).toContain("missing_customer");
      expect(calculateOfflineEntry(retail({ distributorCode: null }), reference, 9).issues.map((value) => value.code)).toContain("missing_customer");
    });

    it("rejects an unknown customer and a customer given twice", () => {
      expect(calculateOfflineEntry(retail({ distributorCode: "C-99" }), reference, 9).issues.map((value) => value.code)).toContain("unknown_customer");
      const both = retail({ newCustomer: { name: "Bilal Store", mobile: null, city: null, address: null } });
      expect(calculateOfflineEntry(both, reference, 9).issues.map((value) => value.code)).toContain("customer_conflict");
    });

    it("allows a discount on any customer type, capped at the items total", () => {
      const ok = calculateOfflineEntry(retail({ invoiceDiscount: 500 }), reference, 9);
      expect(ok.issues).toEqual([]);
      expect([ok.itemsTotal, ok.invoiceDiscount, ok.invoiceAmount]).toEqual([15750, 500, 15250]);
      const shopkeeper = calculateOfflineEntry(retail({ distributorCode: "C-8", invoiceDiscount: 500 }), reference, 9);
      expect(shopkeeper.issues).toEqual([]);
      const distributor = calculateOfflineEntry(direct({ invoiceDiscount: 100 }), reference, 9);
      expect(distributor.issues).toEqual([]);
      expect(distributor.invoiceDiscount).toBe(100);
      const tooBig = calculateOfflineEntry(retail({ invoiceDiscount: 99999 }), reference, 9);
      expect(tooBig.issues.map((value) => value.code)).toContain("discount_exceeds_total");
      const tooBigDistributor = calculateOfflineEntry(direct({ invoiceDiscount: 99999 }), reference, 9);
      expect(tooBigDistributor.issues.map((value) => value.code)).toContain("discount_exceeds_total");
    });

    it("treats a new walk-in as a retailer for discount", () => {
      const walkIn = retail({
        distributorCode: null,
        newCustomer: { name: "Bilal Store", mobile: null, city: null, address: null },
        invoiceDiscount: 100,
      });
      expect(calculateOfflineEntry(walkIn, reference, 9).issues).toEqual([]);
    });
  });

  describe("freight, bank, digital and instant verification", () => {
    const bank = (patch: Partial<OfflineEntry["payments"][number]> = {}) => ({
      method: "bank_transfer" as const,
      amount: 3000,
      walletCode: "W-BANK",
      reference: "TX1",
      chequeBank: null,
      chequeNumber: null,
      chequeDate: null,
      paymentDate: "2026-11-03",
      bank: { senderBankName: "HBL", senderAccountNumber: "PK00-1234" },
      ...patch,
    });

    it("adds freight to the total", () => {
      const result = calculateOfflineEntry(direct({ expenses: 250, expensesDescription: "Loading" }), reference, 7);
      expect([result.itemsTotal, result.expenses, result.invoiceAmount]).toEqual([10500, 250, 10750]);
    });

    it("writes bank and digital notes exactly as the online form does", () => {
      expect(paymentNotes(bank())).toBe("From: HBL (A/C: PK00-1234)");
      expect(paymentNotes(bank({ notes: "advance" }))).toBe("From: HBL (A/C: PK00-1234) · advance");
      const digital = bank({
        bank: null,
        digital: { provider: "EasyPaisa", senderMobile: "0300-1112223", senderTitle: "Ali" },
      });
      expect(paymentNotes(digital)).toBe("[EasyPaisa] From: 0300-1112223 (Ali)");
      expect(paymentNotes({ ...digital, digital: { provider: "JazzCash", senderMobile: "0301", senderTitle: null } })).toBe(
        "[JazzCash] From: 0301",
      );
    });

    it("requires the same bank and digital details as the online form", () => {
      const missingBank = calculateOfflineEntry(direct({ payments: [bank({ bank: null })] }), reference, 7);
      expect(missingBank.issues.map((value) => value.code)).toEqual(
        expect.arrayContaining(["missing_sender_bank", "missing_sender_account"]),
      );
      const missingDigital = calculateOfflineEntry(
        direct({ payments: [bank({ bank: null, reference: null, digital: { provider: "", senderMobile: "", senderTitle: null } })] }),
        reference,
        7,
      );
      expect(missingDigital.issues.map((value) => value.code)).toEqual(
        expect.arrayContaining(["missing_transfer_reference", "missing_digital_provider", "missing_digital_sender"]),
      );
    });

    it("counts an instantly verified payment as paid, not pending", () => {
      const waiting = calculateOfflineEntry(direct({ payments: [bank()] }), reference, 7);
      expect([waiting.paidAmount, waiting.pendingAmount, waiting.outstandingAmount]).toEqual([0, 3000, 10500]);
      expect(waiting.payments[0].instantVerify).toBe(false);
      const verified = calculateOfflineEntry(direct({ payments: [bank({ instantVerify: true })] }), reference, 7);
      expect([verified.paidAmount, verified.pendingAmount, verified.outstandingAmount]).toEqual([3000, 0, 7500]);
      expect(verified.payments[0].instantVerify).toBe(true);
    });

    it("ignores instant verification on cash", () => {
      const result = calculateOfflineEntry(
        direct({
          payments: [
            { method: "cash", amount: 100, walletCode: "W-CASH", reference: null, chequeBank: null, chequeNumber: null, chequeDate: null, paymentDate: "2026-11-03", instantVerify: true },
          ],
        }),
        reference,
        7,
      );
      expect(result.payments[0].instantVerify).toBe(false);
    });

    it("asks for a due date only when part of the total has no payment at all", () => {
      const fullyCovered = calculateOfflineEntry(
        direct({ paymentDueDate: null, payments: [bank({ amount: 10500 })] }),
        reference,
        7,
      );
      expect(fullyCovered.issues).toEqual([]);
      expect(fullyCovered.payLaterAmount).toBe(0);
      const partlyCovered = calculateOfflineEntry(
        direct({ paymentDueDate: null, payments: [bank({ amount: 3000 })] }),
        reference,
        7,
      );
      expect(partlyCovered.issues.map((value) => value.code)).toEqual(["missing_due_date"]);
      expect(partlyCovered.payLaterAmount).toBe(7500);
    });
  });

  describe("free cartons by hand, price changes and salary paid by a distributor", () => {
    const oneItem = (patch: Partial<OfflineEntry["items"][number]>): OfflineEntry["items"] => [
      { productCode: "P1", cartonQuantity: 10, looseUnitQuantity: 6, physicalStockConfirmed: false, ...patch },
    ];

    it("ships a distributor's free cartons on top and bills only the ordered ones", () => {
      // The scheme gives 1 free carton for 10; 2 more are given by hand.
      const result = calculateOfflineEntry(direct({ items: oneItem({ manualFreeCartons: 2 }) }), reference, 7);
      expect(result.issues).toEqual([]);
      expect(result.items[0]).toMatchObject({
        freeCartons: 1,
        manualFreeCartons: 2,
        chargedUnits: 126,
        dispatchedUnits: (10 + 1 + 2) * 12 + 6,
        lineAmount: 10500,
      });
    });

    it("bills a retailer for the ordered cartons less the free ones", () => {
      const retail = direct({ saleType: "direct_retailer", distributorCode: "C-7", items: oneItem({ manualFreeCartons: 2 }) });
      const result = calculateOfflineEntry(retail, reference, 9);
      expect(result.issues).toEqual([]);
      expect(result.items[0]).toMatchObject({
        manualFreeCartons: 2,
        chargedUnits: 8 * 12 + 6,
        dispatchedUnits: 10 * 12 + 6,
        // 8 billed cartons x 1500 + 6 loose packs x 125
        lineAmount: 12750,
      });
    });

    it("keeps manual free cartons within the cartons entered and out of booked orders", () => {
      const tooMany = calculateOfflineEntry(direct({ items: oneItem({ manualFreeCartons: 11 }) }), reference, 7);
      expect(tooMany.issues.map((value) => value.code)).toContain("manual_free_exceeds");
      const booked = calculateOfflineEntry(
        direct({
          saleType: "booked_order",
          distributorCode: null,
          orderBookerCode: "B1",
          billNumber: 55,
          items: [{ productCode: "P1", cartonQuantity: 2, looseUnitQuantity: 0, physicalStockConfirmed: false, manualFreeCartons: 1 }],
        }),
        reference,
        8,
      );
      expect(booked.issues.map((value) => value.code)).toContain("manual_free_not_allowed");
    });

    it("charges a changed price and remembers the listed one", () => {
      const result = calculateOfflineEntry(direct({ items: oneItem({ priceOverride: 900 }) }), reference, 7);
      expect(result.issues).toEqual([]);
      expect(result.items[0]).toMatchObject({
        baseCartonPrice: 900,
        listedCartonPrice: 1000,
        isPriceOverride: true,
        // 10 x 900 + 6 loose packs x 75
        lineAmount: 9450,
      });
    });

    it("does not count the listed price typed back as a change", () => {
      const result = calculateOfflineEntry(direct({ items: oneItem({ priceOverride: 1000 }) }), reference, 7);
      expect(result.items[0].isPriceOverride).toBe(false);
    });

    it("refuses a negative price and any price change on a booked order", () => {
      const negative = calculateOfflineEntry(direct({ items: oneItem({ priceOverride: -5 }) }), reference, 7);
      expect(negative.issues.map((value) => value.code)).toContain("invalid_price_override");
      const booked = calculateOfflineEntry(
        direct({
          saleType: "booked_order",
          distributorCode: null,
          orderBookerCode: "B1",
          billNumber: 55,
          items: [{ productCode: "P1", cartonQuantity: 2, looseUnitQuantity: 0, physicalStockConfirmed: false, priceOverride: 800 }],
        }),
        reference,
        8,
      );
      expect(booked.issues.map((value) => value.code)).toContain("override_not_allowed");
    });

    const offset = (patch: Partial<OfflineEntry["payments"][number]> = {}): OfflineEntry["payments"][number] => ({
      method: "expense_offset",
      amount: 4000,
      walletCode: "",
      expenseEmployeeId: "emp-1",
      reference: null,
      chequeBank: null,
      chequeNumber: null,
      chequeDate: null,
      paymentDate: "2026-11-03",
      ...patch,
    });

    it("counts a salary paid by the distributor as paid, with no account", () => {
      const result = calculateOfflineEntry(direct({ payments: [offset()] }), reference, 7);
      expect(result.issues).toEqual([]);
      expect([result.paidAmount, result.pendingAmount, result.outstandingAmount]).toEqual([4000, 0, 6500]);
      expect(result.payments[0]).toMatchObject({
        method: "expense_offset",
        expenseType: "salesman_salary",
        expenseEmployeeId: "emp-1",
        notes: "Salary paid directly by distributor for Imran",
      });
    });

    it("needs a real salesman", () => {
      const result = calculateOfflineEntry(direct({ payments: [offset({ expenseEmployeeId: "nobody" })] }), reference, 7);
      expect(result.issues.map((value) => value.code)).toContain("invalid_salesman");
      const none = calculateOfflineEntry(direct({ payments: [offset({ expenseEmployeeId: null })] }), reference, 7);
      expect(none.issues.map((value) => value.code)).toContain("invalid_salesman");
    });
  });
});
