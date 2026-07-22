import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { getTransactionsFn, getWalletsListFn } from "@/server-functions/finance-fn";
import { LedgerContainer } from "@/components/finance/ledger-container";

export const Route = createFileRoute("/_protected/finance/ledger/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["wallets"],
      queryFn: getWalletsListFn,
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["transactions"],
      queryFn: () => getTransactionsFn({ data: { limit: 100 } }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <h1 className="font-bold text-3xl uppercase tracking-tighter">
            Ledger
          </h1>
          <p className="mt-2 text-muted-foreground">
            Complete transaction journal across all accounts.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading ledger"
                description="Please wait..."
              />
            }
          >
            <LedgerContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
