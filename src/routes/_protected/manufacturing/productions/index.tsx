import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { ProductionRunsContainer } from "@/components/productions/production-container";
import { getPaginatedProductionRunsFn } from "@/server-functions/inventory/production/get-paginated-production-runs-fn";

export const Route = createFileRoute("/_protected/manufacturing/productions/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: [
        "production-runs",
        {
          search: "",
          dateFilter: "today",
          statusFilter: "all",
          pageIndex: 0,
          pageSize: 10,
        },
      ],
      queryFn: () =>
        getPaginatedProductionRunsFn({
          data: {
            search: "",
            dateFilter: "today",
            statusFilter: "all",
            pageIndex: 0,
            pageSize: 10,
          },
        }),
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
            Production Runs
          </h1>
          <p className="mt-2 text-muted-foreground">
            View production history, batch tracking, and cost analysis for all
            manufacturing runs.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading production runs"
                description="Please wait..."
              />
            }
          >
            <ProductionRunsContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
