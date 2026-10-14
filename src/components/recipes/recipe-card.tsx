import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "../ui/card";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { useDeleteRecipe } from "@/hooks/recipes/use-delete-recipe";
import type { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";

type Recipe = Awaited<ReturnType<typeof getRecipesFn>>[number];
export const RecipeCard = ({
  recipe,
  onEdit,
  canManage = false,
}: {
  recipe: Recipe;
  onEdit?: () => void;
  canManage?: boolean;
}) => {
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const mutation = useDeleteRecipe();
  const hasCartons =
    !!recipe.cartonPackagingId && (recipe.containersPerCarton ?? 0) > 0;
  return (
    <>
      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="break-words text-lg">{recipe.name}</CardTitle>
            {!recipe.formulaId && (
              <Badge variant="outline">Needs a formula</Badge>
            )}
          </div>
          <CardDescription>{recipe.product.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">One pack</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {recipe.fillAmount && recipe.fillUnit
                  ? `${Number(recipe.fillAmount)} ${recipe.fillUnit}`
                  : "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Carton setup</dt>
              <dd className="mt-1 font-semibold">
                {hasCartons
                  ? `${recipe.containersPerCarton} packs / carton`
                  : "Loose packs only"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground break-words">
            Pack material: {recipe.containerPackaging?.name || "Not set"}
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() =>
              navigate({
                to: "/manufacturing/recipes/$recipeId",
                params: { recipeId: recipe.id },
              })
            }
          >
            View details
          </Button>
          {canManage && (
            <>
              <Button variant="outline" onClick={onEdit}>
                Edit
              </Button>
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => setRemoving(true)}
              >
                Remove
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
      <AlertDialog
        open={removing}
        onOpenChange={(open) => {
          if (!mutation.isPending) setRemoving(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {recipe.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This format will leave the active list. If it has stock, packing
              or sales history, it will be archived and those records will be
              kept. An unused format is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              Keep format
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={async () => {
                try {
                  await mutation.mutateAsync({
                    data: { id: recipe.id, force: false },
                  });
                  setRemoving(false);
                } catch {
                  /* Mutation error remains visible. */
                }
              }}
            >
              {mutation.isPending ? "Removing…" : "Remove format"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
