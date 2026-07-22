import { useNavigate } from "@tanstack/react-router";
import { Eye, Play, Trash2, Edit } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";
import { useState } from "react";
import { InitiateProductionSheet } from "../productions/initiate-production-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { useDeleteRecipe } from "@/hooks/recipes/use-delete-recipe";
import { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";

type Recipe = Awaited<ReturnType<typeof getRecipesFn>>[number];

type RecipeCardProps = {
  recipe: Recipe;
  onEdit?: () => void;
};

export const RecipeCard = ({ recipe, onEdit }: RecipeCardProps) => {
  const navigate = useNavigate();
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deleteRecipeMutation = useDeleteRecipe();
  const [forceDeleteMode, setForceDeleteMode] = useState(false); // Added forceDeleteMode state

  // Use targetUnitsPerBatch from the recipe (direct user input)
  const totalContainers = recipe.targetUnitsPerBatch || 0;

  const handleDelete = async (force = false) => {
    try {
      await deleteRecipeMutation.mutateAsync({
        data: { id: recipe.id, force },
      });
      setDeleteDialogOpen(false);
      setForceDeleteMode(false);
    } catch (error: any) {
      // If normal delete fails due to production runs, offer force delete
      if (!force && error.message?.includes("production run")) {
        setForceDeleteMode(true);
      }
    }
  };

  return (
    <>
      <Card className="hover: transition-shadow flex flex-col justify-between h-full group">
        <div>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg line-clamp-1">
                  {recipe.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1 text-ellipsis overflow-hidden whitespace-nowrap">
                  {recipe.product.name}
                </p>
              </div>
              <Badge variant="outline">
                {recipe.fillAmount && recipe.fillUnit
                  ? `${parseInt(recipe.fillAmount).toFixed(0)}${recipe.fillUnit}/Unit`
                  : recipe.containerPackaging?.name || "Loose"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-3"> {/* Changed space-y-4 to space-y-3 */}
            {/* Production Info */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Batch Size</span> {/* Changed p to span */}
                <p className="font-bold"> {/* Changed font-medium to font-bold */}
                  {recipe.batchSize}
                  {recipe.batchUnit} {/* Changed unit display */}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Units</span> {/* Changed p to span */}
                <p className="font-bold">{totalContainers.toLocaleString()}</p> {/* Changed font-medium to font-bold and added toLocaleString */}
              </div>
              <div>
                <span className="text-muted-foreground">Per Carton</span> {/* Changed p to span */}
                <p className="font-bold"> {/* Changed font-medium to font-bold */}
                  {recipe.containersPerCarton || "N/A"} {/* Changed "Loose" to "N/A" */}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Cartons</span> {/* Changed p to span */}
                <p className="font-bold"> {/* Changed font-medium to font-bold */}
                  {recipe.containersPerCarton
                    ? Math.ceil(totalContainers / recipe.containersPerCarton)
                    : 0}
                </p>
              </div>
            </div>

            <Separator /> {/* Added Separator */}

            {/* Cost Info */}
            {/* Removed conditional rendering for the whole block */}
            <div className="grid grid-cols-2 gap-2 text-sm"> {/* Changed div structure */}
              <div>
                <span className="text-muted-foreground"> {/* Changed span to span */}
                  Est. Cost/Unit
                </span>
                <p className="font-bold text-red-600"> {/* Changed span to p, added font-bold and text-red-600 */}
                  PKR{" "}
                  {parseFloat(recipe.estimatedCostPerContainer || "0").toFixed(2)} {/* Added || "0" */}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground"> {/* Changed span to span */}
                  Est. Batch Cost
                </span>
                <p className="font-bold"> {/* Changed span to p, added font-bold */}
                  PKR {parseFloat(recipe.estimatedCostPerBatch || "0").toLocaleString()} {/* Added || "0" and toLocaleString */}
                </p>
              </div>
            </div>

            {/* Ingredients Summary */}
            <div className="text-xs text-muted-foreground">
              {recipe.ingredients?.length || 0} Ingredients •{" "} {/* Added optional chaining and default 0 */}
              {(recipe.packaging?.length || 0) +
                (recipe.containerPackagingId ? 1 : 0) +
                (recipe.cartonPackagingId ? 1 : 0)}{" "} {/* Updated packaging count logic */}
              packaging items
            </div>

            <Button
              variant="default" // Changed variant
              className="w-full"
              size="sm" // Added size
              onClick={() => setInitiateOpen(true)}
            >
              <Play className="size-3 mr-2" /> {/* Changed PlayIcon to Play and size */}
              Initiate Production
            </Button>
          </CardContent>
        </div>

        <div className="px-6 pb-6 flex gap-2"> {/* Changed p-4 pt-0 space-y-3 to px-6 pb-6 flex gap-2 */}
          {/* Secondary Actions */}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onEdit}
          >
            <Edit className="size-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() =>
              navigate({ to: `/manufacturing/recipes/${recipe.id}` })
            }
          >
            <Eye className="size-4 mr-2" />
            View
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              setDeleteDialogOpen(true);
              setForceDeleteMode(false); // Reset force delete mode when opening dialog
            }}
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </Button>
        </div>
      </Card>

      <InitiateProductionSheet
        open={initiateOpen}
        onOpenChange={setInitiateOpen}
        recipe={recipe}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) setForceDeleteMode(false); // Reset force delete mode when dialog closes
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"> {/* Added flex and gap */}
              <Trash2 className="size-5 text-destructive" /> {/* Added icon */}
              {forceDeleteMode ? "Force Delete Recipe?" : "Delete Recipe?"} {/* Dynamic title */}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {forceDeleteMode
                ? "This recipe has associated production runs. Force deleting will remove all related data permanently."
                : `This will permanently delete the recipe "${recipe.name}" and all its associated data. This action cannot be undone.`}
            </AlertDialogDescription>
            {forceDeleteMode && (
              <div className="space-y-3 mt-2">
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <strong>⚠ Warning:</strong> Force deleting will permanently remove:
                </div>
                <ul className="text-sm space-y-1 ml-4 list-disc text-muted-foreground">
                  <li>All production run records for this recipe</li>
                  <li>Material usage logs from those runs</li>
                  <li>Finished goods stock entries</li>
                  <li>The recipe itself and its ingredients/packaging</li>
                </ul>
                <p className="text-sm text-destructive font-semibold">
                  This action cannot be undone.
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteDialogOpen(false);
                setForceDeleteMode(false); // Reset force delete mode on cancel
              }}
              disabled={deleteRecipeMutation.isPending} // Disable while deleting
            >
              Cancel
            </AlertDialogCancel>
            {forceDeleteMode ? (
              <AlertDialogAction
                onClick={() => handleDelete(true)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteRecipeMutation.isPending}
              >
                {deleteRecipeMutation.isPending ? "Deleting..." : "Force Delete Everything"}
              </AlertDialogAction>
            ) : (
              <Button
                onClick={() => handleDelete(false)}
                variant="destructive"
                disabled={deleteRecipeMutation.isPending}
              >
                {deleteRecipeMutation.isPending ? "Deleting..." : "Delete Recipe"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
