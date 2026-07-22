import { createFileRoute, redirect } from "@tanstack/react-router";
import { format, startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute(
  "/_protected/manufacturing/products/$productId/",
)({
  validateSearch: (search: Record<string, unknown>) => {
    const today = new Date();
    return {
      from: String(search.from ?? format(startOfMonth(today), "yyyy-MM-dd")),
      to: String(search.to ?? format(endOfMonth(today), "yyyy-MM-dd")),
    };
  },
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: async ({ params: { productId }, deps: { from, to } }) => {
    throw redirect({
      to: "/reports/profit-loss/product/$productId",
      params: { productId },
      search: { from, to },
    });
  },
});
