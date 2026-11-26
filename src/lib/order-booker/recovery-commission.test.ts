import { describe, expect, it } from "vitest";
import {
  clawbackBase,
  commissionAmount,
  earnableBase,
  paymentEarnsCommission,
  settlePayslipCommission,
  summarizePayslipEntries,
  summarizeBookerMonth,
} from "./recovery-commission";

describe("recovery commission money rules", () => {
  it("earns on cash, bank, cheque and expense offsets but never on store credit", () => {
    expect(["cash", "bank_transfer", "cheque", "expense_offset"].map(paymentEarnsCommission)).toEqual([true, true, true, true]);
    expect(paymentEarnsCommission("customer_credit")).toBe(false);
  });

  it("rounds commission to paisa and keeps the sign", () => {
    expect(commissionAmount(200000, 2)).toBe(4000);
    expect(commissionAmount(-30000, 2)).toBe(-600);
    expect(commissionAmount(333.33, 1.5)).toBe(5);
    expect(commissionAmount(100000, 1.8333)).toBe(1833.3);
  });

  it("caps the earning base at what is still owed and never goes below zero", () => {
    expect(earnableBase({ paymentAmount: 40000, owed: 100000, commissionedBase: 0 })).toBe(40000);
    expect(earnableBase({ paymentAmount: 60000, owed: 100000, commissionedBase: 70000 })).toBe(30000);
    expect(earnableBase({ paymentAmount: 10000, owed: 70000, commissionedBase: 100000 })).toBe(0);
  });

  it("takes back only what was commissioned above what is now owed", () => {
    expect(clawbackBase({ owed: 70000, commissionedBase: 100000 })).toBe(30000);
    expect(clawbackBase({ owed: 70000, commissionedBase: 50000 })).toBe(0);
  });

  it("pays a positive month and carries a negative one forward", () => {
    expect(settlePayslipCommission([{ amount: 4000 }, { amount: 8400 }, { amount: -600 }])).toEqual({
      earned: 12400, deductions: 600, net: 11800, payable: 11800, carriedForward: 0, paysEntries: true,
    });
    // Spec example: Rs 4,000 bounces in November when Rs 1,000 was earned.
    expect(settlePayslipCommission([{ amount: 1000 }, { amount: -4000 }])).toEqual({
      earned: 1000, deductions: 4000, net: -3000, payable: 0, carriedForward: 3000, paysEntries: false,
    });
    // December earns Rs 10,000 with the Rs 3,000 still waiting: pays Rs 7,000.
    expect(settlePayslipCommission([{ amount: 1000 }, { amount: -4000 }, { amount: 10000 }]).payable).toBe(7000);
    expect(settlePayslipCommission([])).toEqual({ earned: 0, deductions: 0, net: 0, payable: 0, carriedForward: 0, paysEntries: false });
  });

  it("summarizes a booker month from invoice, return, payment and ledger rows", () => {
    const monthStart = new Date("2026-10-01T00:00:00+05:00");
    const monthEnd = new Date("2026-10-31T23:59:59.999+05:00");
    const summary = summarizeBookerMonth({
      monthStart,
      monthEnd,
      invoices: [
        { id: "a", date: new Date("2026-10-05T10:00:00+05:00"), totalPrice: 500000, mode: "recovery", rate: 2 },
        { id: "b", date: new Date("2026-09-20T10:00:00+05:00"), totalPrice: 100000, mode: "suppressed", rate: null },
      ],
      returns: [
        { invoiceId: "a", totalAmount: 100000, completedAt: new Date("2026-10-25T10:00:00+05:00"), voidedAt: null },
      ],
      payments: [
        { invoiceId: "a", amount: 200000, method: "cash", status: "confirmed", effectiveDate: new Date("2026-10-20T10:00:00+05:00"), reversedAt: null },
        { invoiceId: "b", amount: 50000, method: "bank_transfer", status: "confirmed", effectiveDate: new Date("2026-10-03T10:00:00+05:00"), reversedAt: null },
        { invoiceId: "a", amount: 5000, method: "customer_credit", status: "confirmed", effectiveDate: new Date("2026-10-21T10:00:00+05:00"), reversedAt: null },
      ],
      entries: [{ amount: 4000, entryDate: new Date("2026-10-20T10:00:00+05:00") }],
    });
    expect(summary).toEqual({
      delivered: 500000, returned: 100000, collected: 250000, earned: 4000,
      stillOwed: 245000, waiting: 3900,
    });
  });
});

describe("summarizePayslipEntries", () => {
  it("keeps payments, take-backs and voided-return add-backs apart", () => {
    expect(summarizePayslipEntries([
      { kind: "payment", amount: 800 },
      { kind: "payment", amount: 1200 },
      { kind: "payment_reversal", amount: -1200 },
      { kind: "payment_reversal", amount: 0 },
      { kind: "payment", amount: 2000 },
      { kind: "return_clawback", amount: -600 },
      { kind: "return_clawback_undo", amount: 600 },
    ])).toEqual({ paymentsCount: 3, earned: 4000, deductions: 1800, addedBack: 600 });
  });
});
