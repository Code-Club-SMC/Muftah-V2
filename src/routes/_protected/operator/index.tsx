import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { OperatorInterface } from "@/components/operator/operator-interface";
import { getProductionRunsFn } from "@/server-functions/inventory/production/get-production-run-fn";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_protected/operator/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["operator-production-runs"],
      queryFn: () => getProductionRunsFn({ data: { filter: "active" } }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto min-h-screen">
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Operator</h2>
          <p className="text-muted-foreground">
            Log your production output below
          </p>
        </div>

        <Separator />
        <Suspense
          fallback={
            <GenericLoader
              className="min-h-svh my-auto"
              title="Loading Production Runs..."
              description="Please wait while we load the production runs."
            />
          }
        >
          <OperatorInterface />
        </Suspense>
      </div>
    </main>
  );
}
