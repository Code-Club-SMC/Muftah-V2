import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { MixingRunsContainer } from "@/components/mixing/mixing-runs-container";
import { getMixingRunsFn } from "@/server-functions/manufacturing/mixing/get-mixing-runs-fn";
import { z } from "zod";

const searchSchema = z.object({
  search: z.string().optional(),
});

export const Route = createFileRoute("/_protected/manufacturing/mixing/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({ search: search.search ?? "" }),
  loader: async ({ context, deps }) => {
    void context.queryClient.prefetchQuery({
      queryKey: [
        "mixing-runs",
        { pageIndex: 0, pageSize: 10, search: deps.search },
      ],
      queryFn: () =>
        getMixingRunsFn({ data: { page: 1, limit: 10, search: deps.search } }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { search = "" } = Route.useSearch();
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <h1 className="font-bold text-3xl uppercase tracking-tighter">
            Mixing Batches
          </h1>
          <p className="mt-2 text-muted-foreground">
            Track each mixing batch from ingredients to completed bulk, ready for packing.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading mixing batches"
                description="Please wait while we fetch production data..."
              />
            }
          >
            <MixingRunsContainer key={search} initialSearch={search} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
