import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { FormulasContainer } from "@/components/formulas/formulas-container";
import { getFormulasFn } from "@/server-functions/manufacturing/formulas/get-formulas-fn";
import { z } from "zod";

const searchSchema = z.object({
  search: z.string().optional(),
});

export const Route = createFileRoute("/_protected/manufacturing/formulas/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search }) => ({ search: search.search ?? "" }),
  loader: async ({ context, deps }) => {
    void context.queryClient.prefetchQuery({
      queryKey: [
        "formulas",
        { pageIndex: 0, pageSize: 10, search: deps.search },
      ],
      queryFn: () =>
        getFormulasFn({
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
            Mixing Formulas
          </h1>
          <p className="mt-2 text-muted-foreground">
            Save the ingredients, batch quantities, and instructions used to mix each product.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading mixing formulas"
                description="Please wait while we fetch mixing formulas..."
              />
            }
          >
            <FormulasContainer key={search} initialSearch={search} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
