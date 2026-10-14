import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { PackagingAllocationsContainer } from "@/components/packaging/packaging-allocations-container";
import { getPaginatedPackagingAllocationsFn } from "@/server-functions/manufacturing/packaging/get-paginated-packaging-allocations-fn";
import { z } from "zod";

const searchSchema = z.object({
  search: z.string().optional(),
});

export const Route = createFileRoute("/_protected/manufacturing/packaging/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({ search: search.search ?? "" }),
  loader: async ({ context, deps }) => {
    void context.queryClient.prefetchQuery({
      queryKey: [
        "packaging-allocations",
        "list",
        { pageIndex: 0, pageSize: 10, search: deps.search },
      ],
      queryFn: () =>
        getPaginatedPackagingAllocationsFn({
          data: { pageIndex: 0, pageSize: 10, search: deps.search },
        }),
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
            Packing records
          </h1>
          <p className="mt-2 text-muted-foreground">
            View recorded packing and earlier jobs. To record new packing, open
            the completed mixing batch.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading packing jobs"
                description="Please wait while we fetch packaging data..."
              />
            }
          >
            <PackagingAllocationsContainer
              key={search}
              initialSearch={search}
            />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
