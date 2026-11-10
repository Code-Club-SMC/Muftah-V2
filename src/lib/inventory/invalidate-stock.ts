import type { QueryClient } from "@tanstack/react-query";

export function invalidateStockQueries(queryClient: QueryClient): Promise<void> {
  const prefixes = [
    "inventory", "factory-floor", "item-detail", "materials",
    "packaging-materials", "material-lots", "purchase-edit-state", "low-stock-alerts",
    "chemical-report-purchases",
  ];
  return Promise.all(prefixes.map(prefix => queryClient.invalidateQueries({ queryKey: [prefix] })))
    .then(() => undefined);
}
