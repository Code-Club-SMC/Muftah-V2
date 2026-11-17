import { describe, expect, it } from "vitest";
import {
  MAX_OTHER_INCOME_AMOUNT,
  normalizeItemName,
  OTHER_INCOME_TX_SOURCE,
  otherIncomeAmount,
} from "@/lib/finance/other-income";

describe("other income helpers", () => {
  it("multiplies quantity by price and rounds to paisa", () => {
    expect(otherIncomeAmount(1, 1500)).toBe("1500.00");
    expect(otherIncomeAmount("2.5", "33.33")).toBe("83.33");
    expect(otherIncomeAmount("0.333", "10")).toBe("3.33");
  });

  it("refuses amounts that round to zero or exceed the column", () => {
    expect(() => otherIncomeAmount("0.001", "1")).toThrow("at least Rs 0.01");
    expect(() => otherIncomeAmount(2, MAX_OTHER_INCOME_AMOUNT)).toThrow("too large");
  });

  it("trims and collapses spaces in item names", () => {
    expect(normalizeItemName("  SLES   drum ")).toBe("SLES drum");
  });

  it("uses a fixed ledger source", () => {
    expect(OTHER_INCOME_TX_SOURCE).toBe("Other Income");
  });
});

import { readFileSync } from "node:fs";

const fnSource = () => readFileSync("src/server-functions/finance/other-income-fn.ts", "utf8");

describe("other income server functions", () => {
  it("guards writes with finance.manage and reads with finance.view", () => {
    const source = fnSource();
    expect(source.match(/requireFinanceManageMiddleware\]/g)?.length).toBe(2);
    expect(source.match(/requireFinanceViewMiddleware\]/g)?.length).toBe(2);
  });

  it("moves money and writes the ledger in one transaction", () => {
    const source = fnSource();
    expect(source.match(/db\.transaction\(/g)?.length).toBe(2);
    expect(source).toContain("source: OTHER_INCOME_TX_SOURCE");
  });

  it("never deletes an entry and refuses a double void", () => {
    const source = fnSource();
    expect(source).not.toContain("delete(otherIncome)");
    expect(source).toContain("already voided");
  });

  it("refuses a void that would take the account below zero", () => {
    expect(fnSource()).toContain("gte(wallets.balance, input.amount)");
  });
});
describe("other income page wiring", () => {
  it("adds Other Income to the Finance sidebar", () => {
    expect(readFileSync("src/lib/constants.ts", "utf8")).toContain('url: "/finance/other-income"');
  });

  it("lists accounts with balances in Received in", () => {
    const page = readFileSync("src/components/finance/other-income-page.tsx", "utf8");
    expect(page).toContain("useWallets()");
    expect(page).toContain("formatRupees(wallet.balance)");
  });

  it("refreshes reports and balances after a money change", () => {
    expect(readFileSync("src/hooks/finance/use-other-income.ts", "utf8")).toContain("invalidateFinanceQueries(queryClient)");
  });
});
