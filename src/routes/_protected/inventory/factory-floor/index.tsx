import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { FactoryFloorContainer } from "@/components/inventory/factory-floor-container";
import { getFactoryFloorStockFn } from "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn";

export const Route = createFileRoute("/_protected/inventory/factory-floor/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["factory-floor"],
      queryFn: getFactoryFloorStockFn,
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
            Factory Floor
          </h1>
          <p className="mt-2 text-muted-foreground">
            Real-time view of materials available for production and finished
            goods awaiting transfer.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading factory floor"
                description="Please wait..."
              />
            }
          >
            <FactoryFloorContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
