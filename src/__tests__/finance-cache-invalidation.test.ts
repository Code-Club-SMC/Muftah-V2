import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";

describe("invalidateFinanceQueries", () => {
  it("invalidates all core finance and report query keys", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });

    const keys = [
      ["wallets"],
      ["expenses"],
      ["expenses", "list", { status: "all" }],
      ["transactions"],
      ["transactions-recent", { limit: 20 }],
      ["reports", "profit-loss"],
      ["reports", "expenses"],
      ["admin-dashboard", "2026-01-01", "2026-01-31"],
      ["dashboard-sync"],
    ];

    for (const key of keys) {
      client.setQueryData(key, { data: "test" });
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    }

    await invalidateFinanceQueries(client);

    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
