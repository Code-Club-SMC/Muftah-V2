import { createFileRoute } from "@tanstack/react-router";
import { getRecipeFn } from "@/server-functions/inventory/recipes/get-single-recipe-fn";
import { RecipeDetailView } from "@/components/recipes/recipe-detail-view";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute(
  "/_protected/manufacturing/recipes/$recipeId",
)({
  loader: async ({ context: { queryClient }, params: { recipeId } }) => {
    return queryClient.ensureQueryData({
      queryKey: ["recipe", recipeId],
      queryFn: () => getRecipeFn({ data: { id: recipeId } }),
    });
  },
  component: RecipeDetailComponent,
  errorComponent: () => (
    <div className="p-8 text-center text-destructive">
      Failed to load recipe.
    </div>
  ),
  pendingComponent: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  ),
});

function RecipeDetailComponent() {
  const recipe = Route.useLoaderData();

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <RecipeDetailView recipe={recipe as any} />
      </div>
    </main>
  );
}
