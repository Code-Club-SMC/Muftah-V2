import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { getFormulaByIdFn } from "@/server-functions/manufacturing/formulas/get-formula-by-id-fn";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { FormulaDetailsContainer } from "@/components/formulas/formula-details-container";

export const Route = createFileRoute(
  "/_protected/manufacturing/formulas/$formulaId/"
)({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["formula", params.formulaId],
      queryFn: () => getFormulaByIdFn({ data: { id: params.formulaId } }),
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { formulaId } = Route.useParams();

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8 gap-6">
        <header className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link to="/manufacturing/formulas">
              <ArrowLeftIcon className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-bold text-3xl uppercase tracking-tighter">
              Mixing Formula Details
            </h1>
          </div>
        </header>

        <Suspense
          fallback={<GenericLoader title="Loading mixing formula details..." />}
        >
          <FormulaDetailsContainer formulaId={formulaId} />
        </Suspense>
      </div>
    </main>
  );
}
