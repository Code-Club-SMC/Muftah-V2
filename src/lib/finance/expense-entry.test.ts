import { describe, expect, it } from "vitest";
import {
  QUICK_CATEGORY_COUNT,
  filterPayeeSuggestions,
  formatAmountInput,
  formatRupees,
  getBalanceAfter,
  getExpenseTitle,
  isNewExpenseShortcut,
  isTypingTarget,
  parseAmountInput,
  pickQuickCategories,
} from "./expense-entry";

describe("amount typing", () => {
  it.each([
    ["", ""],
    ["abc", ""],
    ["100", "100"],
    ["1000", "1,000"],
    ["1250000", "12,50,000"],
    ["12,50,000", "12,50,000"],
    ["123456789", "12,34,56,789"],
    ["0005", "5"],
    ["0", "0"],
    ["1234.567", "1,234.56"],
    ["1234.", "1,234."],
    [".5", "0.5"],
  ])("formats %j as %j", (raw, formatted) => {
    expect(formatAmountInput(raw)).toBe(formatted);
  });

  it("reads the typed amount back as a number", () => {
    expect(parseAmountInput("12,50,000")).toBe(1250000);
    expect(parseAmountInput("1,234.")).toBe(1234);
    expect(parseAmountInput("1,234.56")).toBe(1234.56);
    expect(parseAmountInput("")).toBe(0);
  });
});

describe("rupee text and balances", () => {
  it.each([
    [2000, "Rs 2,000"],
    ["-3000.00", "−Rs 3,000"],
    ["85000.5", "Rs 85,000.50"],
    [0, "Rs 0"],
    ["1250000", "Rs 12,50,000"],
  ])("writes %j as %j", (value, text) => {
    expect(formatRupees(value)).toBe(text);
  });

  it("works out the balance after a debit and an optional credit", () => {
    expect(getBalanceAfter("2000.00", 5000)).toBe("-3000.00");
    expect(getBalanceAfter(undefined, 100)).toBe("-100.00");
    expect(getBalanceAfter("100", "50.5", 10)).toBe("59.50");
  });
});

describe("payee suggestions", () => {
  const payees = ["LESCO", "Shell Pump Ravi Road", "Landlord", "PSO Pump"];

  it("shows the first names when nothing is typed", () => {
    expect(filterPayeeSuggestions(payees, "", 2)).toEqual(["LESCO", "Shell Pump Ravi Road"]);
  });

  it("matches any part of the name, ignoring case", () => {
    expect(filterPayeeSuggestions(payees, "pump")).toEqual(["Shell Pump Ravi Road", "PSO Pump"]);
  });

  it("hides the list once the exact name is typed", () => {
    expect(filterPayeeSuggestions(payees, "lesco")).toEqual([]);
  });
});

describe("quick categories", () => {
  const categories = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));

  it("puts the most used first, then fills up in the normal order", () => {
    expect(pickQuickCategories(categories, ["h", "g", "missing"]).map((c) => c.id)).toEqual([
      "h", "g", "a", "b", "c", "d",
    ]);
  });

  it("never shows more than six", () => {
    expect(pickQuickCategories(categories, [])).toHaveLength(QUICK_CATEGORY_COUNT);
  });
});

describe("list title", () => {
  it("uses the note when there is one", () => {
    expect(getExpenseTitle({ description: " October bill ", payee: "LESCO", category: { name: "Electricity" } })).toBe("October bill");
  });

  it("falls back to Category · Paid to", () => {
    expect(getExpenseTitle({ description: "", payee: "LESCO", category: { name: "Electricity" } })).toBe("Electricity · LESCO");
    expect(getExpenseTitle({ description: "", payee: null, category: { name: "Electricity" } })).toBe("Electricity");
    expect(getExpenseTitle({ description: "", payee: null, category: null })).toBe("Expense");
  });
});

describe("N shortcut", () => {
  const key = (overrides: Partial<Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target">> = {}) => ({
    key: "n", ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: document.body, ...overrides,
  });

  it("knows when someone is typing", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("opens the form on a plain N only", () => {
    expect(isNewExpenseShortcut(key())).toBe(true);
    expect(isNewExpenseShortcut(key({ key: "N" }))).toBe(true);
    expect(isNewExpenseShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ metaKey: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ altKey: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ repeat: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ key: "m" }))).toBe(false);
    expect(isNewExpenseShortcut(key({ target: document.createElement("input") }))).toBe(false);
  });
});
