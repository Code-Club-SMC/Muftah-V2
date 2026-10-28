import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { getMixingRunsFn } from "@/server-functions/manufacturing/mixing/get-mixing-runs-fn";
import { MixingOperatorInterface } from "@/components/operator/mixing-operator-interface";

export const Route = createFileRoute("/_protected/operator/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["operator-mixing-runs", "list", { page: 1, search: "", stage: "all" }],
      queryFn: () =>
        getMixingRunsFn({
          data: {
            statuses: ["in_progress", "scheduled", "completed"],
            page: 1,
            limit: 10,
            search: "",
          },
        }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto min-h-screen">
      <div className="space-y-6">
        <div className="p-4 pb-0 sm:p-6 sm:pb-0">
          <h2 className="text-3xl font-bold tracking-tight">
            Production Workstation
          </h2>
          <p className="text-muted-foreground mt-2">
            Open a batch to record mixing or enter its finished packing.
          </p>
        </div>

        <div className="px-4 sm:px-6">
          <Suspense fallback={<GenericLoader title="Loading..." />}>
            <MixingOperatorInterface />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
