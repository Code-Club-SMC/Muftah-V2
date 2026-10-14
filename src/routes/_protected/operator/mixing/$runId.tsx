import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { getMixingRunFn } from "@/server-functions/manufacturing/mixing/get-mixing-run-fn";
import { MixingConsole } from "@/components/operator/mixing-console";

export const Route = createFileRoute("/_protected/operator/mixing/$runId")({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["operator-mixing-run", params.runId],
      queryFn: () => getMixingRunFn({ data: { id: params.runId } }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { runId } = Route.useParams();

  return (
    <Suspense
      fallback={
        <GenericLoader
          className="min-h-svh my-auto"
          title="Loading mixing batch..."
          description="Connecting to factory floor controls..."
        />
      }
    >
      <MixingConsole runId={runId} />
    </Suspense>
  );
}
