import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates all finance-related queries across the app:
 * - wallets: balances and cards
 * - expenses: expense lists, category breakdowns, KPIs
 * - transactions: general ledger table
 * - transactions-recent: recent transactions widget
 * - reports: profit & loss and expense reports
 * - admin-dashboard & dashboard-sync: dashboard financial metrics
 */
export function invalidateFinanceQueries(queryClient: QueryClient): Promise<void> {
  const prefixes = [
    "wallets",
    "expenses",
    "transactions",
    "transactions-recent",
    "reports",
    "admin-dashboard",
    "dashboard-sync",
  ];
  return Promise.all(
    prefixes.map((prefix) => queryClient.invalidateQueries({ queryKey: [prefix] })),
  ).then(() => undefined);
}
