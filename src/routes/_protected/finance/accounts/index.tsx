import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { FinanceContainer } from "@/components/finance/finance-container";
import { getWalletsListFn, getTransactionsFn } from "@/server-functions/finance-fn";
import { getExpenseListQueryOptions } from "@/hooks/finance/use-finance";

import { startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute("/_protected/finance/accounts/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["wallets"],
      queryFn: getWalletsListFn,
    });

    const today = new Date();
    const dateFrom = startOfMonth(today).toISOString();
    const dateTo = endOfMonth(today).toISOString();

    void context.queryClient.prefetchQuery({
      queryKey: ["transactions-recent", { limit: 20, dateFrom, dateTo }],
      queryFn: () => getTransactionsFn({ data: { limit: 20, dateFrom, dateTo } }),
    });
    void context.queryClient.prefetchQuery(
      getExpenseListQueryOptions({
        page: 1,
        limit: 60,
        offset: 0,
        dateFrom,
        dateTo,
      }),
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <h1 className="font-bold text-3xl uppercase tracking-tighter">
            Finance
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage accounts, track expenses, and monitor cash flow across all
            payment sources.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading finance"
                description="Please wait..."
              />
            }
          >
            <FinanceContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
