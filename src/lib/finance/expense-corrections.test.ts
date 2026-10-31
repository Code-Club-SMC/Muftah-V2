import { describe, expect, it } from "vitest";
import {
  EXPENSE_AUTO_LOCK_MESSAGE,
  EXPENSE_VOIDED_MESSAGE,
  OVERDRAW_CONFIRM_REQUIRED,
  describeExpenseCorrection,
  describeWalletChange,
  diffExpenseSnapshots,
  getExpenseLockReason,
  isOverdrawConfirmError,
  overdrawError,
  planExpenseWalletChanges,
  toExpenseSnapshot,
} from "./expense-corrections";

describe("overdraft marker", () => {
  it("builds an error the form can recognise", () => {
    const error = overdrawError("Cash in Hand", "-2000.00");
    expect(error.message).toBe(`${OVERDRAW_CONFIRM_REQUIRED}: "Cash in Hand" would go to −Rs 2,000`);
    expect(isOverdrawConfirmError(error)).toBe(true);
    expect(isOverdrawConfirmError(new Error("Wallet not found"))).toBe(false);
    expect(isOverdrawConfirmError("nope")).toBe(false);
  });
});

describe("planExpenseWalletChanges", () => {
  it.each([
    [{ walletId: "cash", amount: "5000.00" }, { walletId: "cash", amount: 5000 }, []],
    [{ walletId: "cash", amount: "5000.00" }, { walletId: "cash", amount: 5500 }, [{ walletId: "cash", type: "debit", amount: "500.00" }]],
    [{ walletId: "cash", amount: "5000.00" }, { walletId: "cash", amount: 4000 }, [{ walletId: "cash", type: "credit", amount: "1000.00" }]],
    [
      { walletId: "cash", amount: "5000.00" },
      { walletId: "bank", amount: 5000 },
      [
        { walletId: "cash", type: "credit", amount: "5000.00" },
        { walletId: "bank", type: "debit", amount: "5000.00" },
      ],
    ],
    [{ walletId: "cash", amount: "0.10" }, { walletId: "cash", amount: 0.3 }, [{ walletId: "cash", type: "debit", amount: "0.20" }]],
  ])("plans %j -> %j", (before, after, changes) => {
    expect(planExpenseWalletChanges(before, after)).toEqual(changes);
  });
});

describe("wording", () => {
  it("names the original expense date", () => {
    expect(describeExpenseCorrection("correction", new Date(2026, 9, 12, 10))).toBe("Correction to expense of 12 Oct 2026");
    expect(describeExpenseCorrection("void", new Date(2026, 9, 12, 10))).toBe("Void of expense of 12 Oct 2026");
  });

  it("explains what happens to an account", () => {
    expect(describeWalletChange({ walletId: "cash", type: "debit", amount: "500.00" }, "Cash in Hand")).toBe("Rs 500 more will be taken from Cash in Hand");
    expect(describeWalletChange({ walletId: "cash", type: "credit", amount: "1000.00" }, "Cash in Hand")).toBe("Rs 1,000 goes back to Cash in Hand");
  });
});

describe("snapshots", () => {
  const source = {
    amount: "5000.00",
    description: "",
    payee: null,
    slipNumber: null,
    expenseDate: new Date(2026, 9, 12, 10),
    categoryName: "Electricity",
    walletName: "Cash in Hand",
    fields: [{ label: "Meter no.", displayValue: "M-12" }],
  };

  it("lists the fields in a fixed order", () => {
    expect(toExpenseSnapshot(source)).toEqual({
      Amount: "Rs 5,000",
      Category: "Electricity",
      "Paid to": "",
      "Paid from": "Cash in Hand",
      Date: "12 Oct 2026",
      Note: "",
      "Slip / ref": "",
      "Meter no.": "M-12",
    });
  });

  it("reports only what changed, in order", () => {
    const before = toExpenseSnapshot(source);
    const after = toExpenseSnapshot({ ...source, amount: "5500.00", payee: "LESCO", fields: [] });
    expect(diffExpenseSnapshots(before, after)).toEqual([
      { field: "Amount", from: "Rs 5,000", to: "Rs 5,500" },
      { field: "Paid to", from: "", to: "LESCO" },
      { field: "Meter no.", from: "M-12", to: "" },
    ]);
    expect(diffExpenseSnapshots(before, before)).toEqual([]);
  });
});

describe("getExpenseLockReason", () => {
  it("allows manual expenses that are not voided", () => {
    expect(getExpenseLockReason({ origin: "manual", voidedAt: null })).toBeNull();
  });

  it("locks expenses made by other screens", () => {
    expect(getExpenseLockReason({ origin: "system", voidedAt: null })).toBe(EXPENSE_AUTO_LOCK_MESSAGE);
  });

  it("locks voided expenses", () => {
    expect(getExpenseLockReason({ origin: "manual", voidedAt: new Date() })).toBe(EXPENSE_VOIDED_MESSAGE);
  });
});
