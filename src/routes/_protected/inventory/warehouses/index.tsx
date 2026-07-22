import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { InventoryContainer } from "@/components/inventory/inventory-container";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
export const Route = createFileRoute("/_protected/inventory/warehouses/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["inventory"],
      queryFn: getInventoryFn,
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
            Manage Inventory
          </h1>
          <p className="mt-2 text-muted-foreground">
            Create warehouses, manage low stock warnings, add, remove or update
            current stock accross warehouses.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading inventory"
                description="Please hold by..."
              />
            }
          >
            <InventoryContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
