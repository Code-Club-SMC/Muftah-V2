import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { getMixingRunFn } from "@/server-functions/manufacturing/mixing/get-mixing-run-fn";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { MixingRunDetailsContainer } from "@/components/mixing/mixing-run-details-container";

export const Route = createFileRoute(
  "/_protected/manufacturing/mixing/$runId/"
)({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["mixing-run", params.runId],
      queryFn: () => getMixingRunFn({ data: { id: params.runId } }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { runId } = Route.useParams();

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8 gap-6">
        <header className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link to="/manufacturing/mixing">
              <ArrowLeftIcon className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-bold text-3xl uppercase tracking-tighter">
              Mixing Batch Details
            </h1>
          </div>
        </header>

        <Suspense
          fallback={<GenericLoader title="Loading mixing batch details..." />}
        >
          <MixingRunDetailsContainer runId={runId} />
        </Suspense>
      </div>
    </main>
  );
}
