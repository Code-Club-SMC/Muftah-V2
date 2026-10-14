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
      <div className="flex flex-col min-h-full p-4 sm:p-6 lg:p-8">
        <header className="border-b pb-8">
          <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
            Packaging Formats
          </h1>
          <p className="mt-2 text-muted-foreground">
            Choose a pack by name, size and carton setup. Managers can add or update formats.
          </p>
        </header>
        <div className="flex-1 py-8 flex flex-col">
          <Suspense
            fallback={
              <GenericLoader
                title="Loading packaging formats"
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
