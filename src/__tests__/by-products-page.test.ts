import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("by-products page wiring", () => {
  it("renames the sidebar entry", () => {
    const constants = read("src/lib/constants.ts");
    expect(constants).toContain('title: "By-Products"');
    expect(constants).toContain('url: "/finance/by-products"');
    expect(constants).not.toContain("/finance/other-income");
  });

  it("redirects the old address", () => {
    const old = read("src/routes/_protected/finance/other-income/index.tsx");
    expect(old).toContain('redirect({ to: "/finance/by-products"');
  });

  it("shows earned, sold and in hand, and caps the sale at in hand", () => {
    const page = read("src/components/finance/by-products-page.tsx");
    expect(page).toContain("In hand");
    expect(page).toContain("max={selected?.inHand");
    expect(page).toContain("row.inHand > 0");
    expect(page).toContain("formatRupees(wallet.balance)");
  });

  it("refreshes balances and reports after a money change", () => {
    expect(read("src/hooks/finance/use-by-products.ts")).toContain("invalidateFinanceQueries(queryClient)");
  });
});
