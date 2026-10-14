import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PlusIcon } from "lucide-react";
import { useCreatePackagingAllocation } from "@/hooks/manufacturing/packaging/use-packaging-mutations";
import { useQuery } from "@tanstack/react-query";
import { getMixingRunFn } from "@/server-functions/manufacturing/mixing/get-mixing-run-fn";
import { getManufacturingAssignmentOptionsFn } from "@/server-functions/manufacturing/get-assignment-options-fn";
import Big from "big.js";
import { getPackagingTarget } from "@/lib/production/packaging-quantity";

export function CreateAllocationDialog({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const createAllocation = useCreatePackagingAllocation();

  const { data: run } = useQuery({
    queryKey: ["mixing-run", runId],
    queryFn: () => getMixingRunFn({ data: { id: runId } }),
  });
  const { data: assignmentOptions } = useQuery({
    queryKey: ["manufacturing-assignment-options"],
    queryFn: () => getManufacturingAssignmentOptionsFn(),
  });

  const [recipeId, setRecipeId] = useState("");
  const [allocatedBulkQuantity, setAllocatedBulkQuantity] = useState("");
  const [operatorId, setOperatorId] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targets || previewError || availableBulk.lt(allocatedBulkQuantity))
      return;
    createAllocation.mutate(
      {
        data: {
          mixingRunId: runId,
          recipeId,
          allocatedBulkQuantity: Number(allocatedBulkQuantity),
          operatorId,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setRecipeId("");
          setAllocatedBulkQuantity("");
          setOperatorId("");
        },
      },
    );
  }

  const availableRecipes =
    run?.formula?.recipes.filter((recipe) => recipe.isActive) || [];
  const allocated =
    run?.packagingAllocations
      .filter((allocation) => allocation.status !== "cancelled")
      .reduce(
        (sum, allocation) => sum.plus(allocation.allocatedBulkQuantity),
        new Big(0),
      ) ?? new Big(0);
  const remainingBulk = new Big(run?.actualBulkProduced ?? 0).minus(allocated);
  const availableBulk = remainingBulk.gt(0) ? remainingBulk : new Big(0);
  const selectedRecipe = availableRecipes.find(
    (recipe) => recipe.id === recipeId,
  );
  let targets:
    | { containers: number; cartons: number; loose: number }
    | undefined;
  let previewError = "";
  if (selectedRecipe && allocatedBulkQuantity && run) {
    try {
      const containers = getPackagingTarget(
        allocatedBulkQuantity,
        selectedRecipe.fillAmount,
        selectedRecipe.fillUnit,
        run.bulkUnit,
      );
      if (containers < 1)
        throw new Error("Quantity to pack is less than one container fill");
      const perCarton = selectedRecipe.cartonPackagingId
        ? (selectedRecipe.containersPerCarton ?? 0)
        : 0;
      targets = {
        containers,
        cartons: perCarton > 0 ? Math.floor(containers / perCarton) : 0,
        loose: perCarton > 0 ? containers % perCarton : containers,
      };
    } catch (error) {
      previewError =
        error instanceof Error ? error.message : "Enter a valid bulk quantity";
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="w-4 h-4 mr-2" />
          Create Packing Job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Packing Job</DialogTitle>
          <DialogDescription>
            Choose a packaging format, quantity to pack, and operator.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="allocation-recipe"
              className="text-sm font-medium mb-1 block"
            >
              Packaging Format
            </label>
            <select
              id="allocation-recipe"
              required
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
            >
              <option value="" disabled>
                Select Packaging Format
              </option>
              {availableRecipes.map((recipe: any) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name} ({recipe.fillAmount} {recipe.fillUnit})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="allocation-bulk"
              className="text-sm font-medium mb-1 block"
            >
              Quantity to Pack ({run?.bulkUnit ?? "units"})
            </label>
            <Input
              id="allocation-bulk"
              required
              type="number"
              min="0.001"
              max={availableBulk.toString()}
              step="0.001"
              value={allocatedBulkQuantity}
              onChange={(e) => setAllocatedBulkQuantity(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Available: {availableBulk.toFixed(3)} {run?.bulkUnit}
            </p>
            {targets && (
              <p role="status" className="mt-1 text-sm">
                {targets.containers} containers · {targets.cartons} full cartons
                · {targets.loose} loose units
              </p>
            )}
            {previewError && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {previewError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="allocation-operator"
              className="text-sm font-medium mb-1 block"
            >
              Packaging operator
            </label>
            <select
              id="allocation-operator"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
            >
              <option value="" disabled>
                Select an operator
              </option>
              {assignmentOptions?.operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </select>
          </div>

          {createAllocation.error && (
            <p role="alert" className="text-sm text-destructive">
              {createAllocation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createAllocation.isPending ||
                run?.status !== "completed" ||
                availableBulk.lte(0) ||
                !targets ||
                !!previewError
              }
            >
              {createAllocation.isPending ? "Creating..." : "Create Packing Job"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
