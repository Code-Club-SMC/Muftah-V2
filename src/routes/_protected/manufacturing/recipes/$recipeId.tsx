import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getRecipeFn } from "@/server-functions/inventory/recipes/get-single-recipe-fn";
import { RecipeDetailView } from "@/components/recipes/recipe-detail-view";
import { Loader2 } from "lucide-react";

const recipeQuery = (recipeId: string) =>
  queryOptions({
    queryKey: ["recipe", recipeId],
    queryFn: () => getRecipeFn({ data: { id: recipeId } }),
  });

export const Route = createFileRoute(
  "/_protected/manufacturing/recipes/$recipeId",
)({
  loader: async ({ context: { queryClient }, params: { recipeId } }) => {
    await queryClient.ensureQueryData(recipeQuery(recipeId));
  },
  component: RecipeDetailComponent,
  errorComponent: () => (
    <div className="p-8 text-center text-destructive">
      Failed to load packaging format.
    </div>
  ),
  pendingComponent: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  ),
});

function RecipeDetailComponent() {
  const { recipeId } = Route.useParams();
  const { data: recipe } = useSuspenseQuery(recipeQuery(recipeId));

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <RecipeDetailView recipe={recipe} />
      </div>
    </main>
  );
}
