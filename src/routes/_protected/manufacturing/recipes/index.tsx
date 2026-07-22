import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { RecipesContainer } from "@/components/recipes/recipes-container";
import { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";
import { z } from "zod";

const recipeSearchSchema = z.object({
  edit: z.string().optional(),
});

export const Route = createFileRoute("/_protected/manufacturing/recipes/")({
  validateSearch: (search) => recipeSearchSchema.parse(search),
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["recipes"],
      queryFn: getRecipesFn,
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
            Production Recipes
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage product recipes with ingredient formulas, packaging
            configurations, and cost estimates.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading recipes"
                description="Please wait..."
              />
            }
          >
            <RecipesContainer />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
