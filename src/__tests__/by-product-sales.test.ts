import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BY_PRODUCT_TX_SOURCE, MAX_SALE_AMOUNT, saleAmount } from "@/lib/finance/by-product-sales";

describe("by-product sale helpers", () => {
  it("multiplies whole quantity by price and rounds to paisa", () => {
    expect(saleAmount(3, 1500)).toBe("4500.00");
    expect(saleAmount("2", "33.335")).toBe("66.67");
  });
  it("refuses zero and too-large amounts", () => {
    expect(() => saleAmount(1, "0.001")).toThrow("at least Rs 0.01");
    expect(() => saleAmount(2, MAX_SALE_AMOUNT)).toThrow("too large");
  });
  it("uses a fixed ledger source", () => {
    expect(BY_PRODUCT_TX_SOURCE).toBe("By-Products");
  });
});

const fnSource = () => readFileSync("src/server-functions/finance/by-products-fn.ts", "utf8");

describe("by-product sale server functions", () => {
  it("guards writes with finance.manage and reads with finance.view", () => {
    const s = fnSource();
    expect(s.match(/requireFinanceManageMiddleware\]/g)?.length).toBe(2);
    expect(s.match(/requireFinanceViewMiddleware\]/g)?.length).toBe(1);
  });
  it("checks in hand inside the transaction after the lock", () => {
    const s = fnSource();
    const lock = s.indexOf("await lockByProductMaterial(tx, ref)");
    expect(lock).toBeGreaterThan(s.indexOf("db.transaction("));
    expect(s.indexOf("in hand")).toBeGreaterThan(lock);
  });
  it("only sells whole containers", () => {
    expect(fnSource()).toContain(".int(");
  });
  it("never deletes a sale and refuses double void", () => {
    const s = fnSource();
    expect(s).not.toContain("delete(otherIncome)");
    expect(s).toContain("already voided");
  });
  it("refuses a void that would take the account below zero", () => {
    expect(fnSource()).toContain("gte(wallets.balance, input.amount)");
  });
});
