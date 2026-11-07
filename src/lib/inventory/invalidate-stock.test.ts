import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { invalidateStockQueries } from "./invalidate-stock";

it("invalidates stock prefixes and their children without touching unrelated settings", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const prefixes = ["inventory", "factory-floor", "item-detail", "materials", "packaging-materials", "material-lots", "purchase-edit-state", "low-stock-alerts", "chemical-report-purchases"];
  const keys = prefixes.flatMap(prefix => [[prefix], [prefix, "chemical", "c", 4]]);
  for (const key of keys) client.setQueryData(key, { quantity: "10" });
  client.setQueryData(["unrelated-settings"], {});
  await invalidateStockQueries(client);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["unrelated-settings"])?.isInvalidated).toBe(false);
  client.clear();
});
