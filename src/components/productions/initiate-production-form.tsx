import { useForm } from "@tanstack/react-form";
import { Loader2, PlayIcon, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useCreateProductionRun } from "@/hooks/production/use-create-production-run";
import { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { getOperatorsFn } from "@/server-functions/inventory/production/get-operators-fn";
import { useMemo } from "react";
import { Alert, AlertDescription } from "../ui/alert";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getPlannedPackagingQuantity } from "@/lib/recipe-packaging";

type Recipe = Awaited<ReturnType<typeof getRecipesFn>>[number];

type Props = {
  onOpenChange: (open: boolean) => void;
  preselectedRecipe?: Recipe;
};

export const InitiateProductionForm = ({
  onOpenChange,
  preselectedRecipe,
}: Props) => {
  const createProductionMutation = useCreateProductionRun();

  const { data: recipes } = useSuspenseQuery({
    queryKey: ["recipes"],
    queryFn: getRecipesFn,
  }) as { data: Awaited<ReturnType<typeof getRecipesFn>> };

  const { data: warehouses } = useSuspenseQuery({
    queryKey: ["warehouses"],
    queryFn: getInventoryFn,
  }) as { data: Awaited<ReturnType<typeof getInventoryFn>> };

  const { data: operators } = useSuspenseQuery({
    queryKey: ["operators-list"],
    queryFn: getOperatorsFn,
  });

  const factoryFloor = useMemo(
    () => warehouses.find((w) => w.type === "factory_floor"),
    [warehouses],
  );

  const form = useForm({
    defaultValues: {
      recipeId: preselectedRecipe?.id || "",
      warehouseId: factoryFloor?.id || "",
      operatorId: "",
      batchesProduced: 1,
      notes: "",
    },
    onSubmit: async ({ value }) => {
      try {
        await createProductionMutation.mutateAsync({
          data: {
            ...value,
            warehouseId: factoryFloor?.id || value.warehouseId, // Ensure FF ID is used
          },
        });
        toast.success("Production Scheduled Successfully", {
          description: "You can now start the run from the production table.",
        });
        onOpenChange(false);
      } catch (error) {
        toast.error("Failed to schedule production");
      }
    },
  });

  if (!factoryFloor) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>
          No "Factory Floor" warehouse found. Please create one in Settings &gt;
          Inventory.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="recipeId">
          {(field) => (
            <Field>
              <FieldLabel>Recipe</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select recipe" />
                </SelectTrigger>
                <SelectContent>
                  {recipes.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <div className="flex flex-col">
                        <span>{r.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.batchSize} {r.batchUnit} batch
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="operatorId"
          validators={{
            onSubmit: ({ value }) =>
              !value ? "Select an operator first" : undefined,
          }}
        >
          {(field) => (
            <Field>
              <FieldLabel>Assigned Operator</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select operator..." />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      <div className="flex items-center justify-between w-full gap-4">
                        <span>{op.name}</span>
                        {op.role && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {op.role}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        {/* Hidden Wrapper for calculations */}
        <form.Subscribe
          selector={(state) => [
            state.values.recipeId,
            state.values.batchesProduced,
          ]}
        >
          {([recipeId, batchesProduced]) => {
            const currentRecipe =
              preselectedRecipe || recipes.find((r) => r.id === recipeId);
            if (!currentRecipe) return null;

            const batches = Number(batchesProduced) || 1;
            const warehouse = factoryFloor;

            // Calculation Logic
            let totalChemicalCost = 0;
            let totalPackagingCost = 0;
            const insufficientStock: string[] = [];

            // 1. Chemicals Calculation
            currentRecipe.ingredients.forEach((ing) => {
              if (!ing.chemical) return;
              const requiredQty = Number(ing.quantityPerBatch || 0) * batches;
              const costPerUnit = Number(ing.chemical.costPerUnit || 0);
              totalChemicalCost += requiredQty * costPerUnit;

              const stockItem = (warehouse.materialStock || []).find(
                (s) =>
                  s.chemicalId === ing.chemicalId ||
                  s.chemical?.id === ing.chemicalId,
              );
              const available = Number(stockItem?.quantity || 0);
              if (available < requiredQty) {
                insufficientStock.push(
                  `${ing.chemical.name} (Need ${requiredQty.toFixed(1)}, Have ${available.toFixed(1)})`,
                );
              }
            });

            // 2. Output Calculation
            const totalContainers =
              (currentRecipe.targetUnitsPerBatch || 0) * batches;
            const containersPerCarton = currentRecipe.containersPerCarton || 0;
            const totalCartons =
              containersPerCarton > 0
                ? Math.ceil(totalContainers / containersPerCarton)
                : 0;

            // 3. Packaging Calculation
            if (currentRecipe.containerPackaging) {
              const required = totalContainers;
              totalPackagingCost +=
                required *
                Number(currentRecipe.containerPackaging.costPerUnit || 0);
              const stock = (warehouse.materialStock || []).find(
                (s) =>
                  s.packagingMaterialId === currentRecipe.containerPackagingId,
              );
              if (Number(stock?.quantity || 0) < required)
                insufficientStock.push(
                  `${currentRecipe.containerPackaging.name} (Need ${required}, Have ${Number(stock?.quantity || 0).toFixed(0)})`,
                );
            }

            if (currentRecipe.cartonPackaging && totalCartons > 0) {
              totalPackagingCost +=
                totalCartons *
                Number(currentRecipe.cartonPackaging.costPerUnit || 0);
              const stock = (warehouse.materialStock || []).find(
                (s) =>
                  s.packagingMaterialId === currentRecipe.cartonPackagingId,
              );
              if (Number(stock?.quantity || 0) < totalCartons)
                insufficientStock.push(
                  `${currentRecipe.cartonPackaging.name} (Need ${totalCartons}, Have ${Number(stock?.quantity || 0).toFixed(0)})`,
                );
            }

            currentRecipe.packaging.forEach((pkg) => {
              if (!pkg.packagingMaterial) return;
              const required = getPlannedPackagingQuantity({
                quantityPerContainer: pkg.quantityPerContainer,
                usageBasis: pkg.usageBasis,
                targetUnits: totalContainers,
                containersPerCarton,
              });
              totalPackagingCost +=
                required * Number(pkg.packagingMaterial.costPerUnit || 0);
              const stock = (warehouse.materialStock || []).find(
                (s) => s.packagingMaterialId === pkg.packagingMaterialId,
              );
              if (Number(stock?.quantity || 0) < required)
                insufficientStock.push(
                  `${pkg.packagingMaterial.name} (Need ${required}, Have ${Number(stock?.quantity || 0).toFixed(0)})`,
                );
            });

            const grandTotal = totalChemicalCost + totalPackagingCost;
            const isReady = insufficientStock.length === 0;

            return (
              <div className="space-y-4">
                <div
                  className={cn(
                    "border rounded-lg p-4 space-y-3",
                    isReady
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3
                      className={cn(
                        "font-semibold text-sm",
                        isReady ? "text-green-800" : "text-red-800",
                      )}
                    >
                      {isReady ? "Ready to Produce" : "Insufficient Stock"}
                    </h3>
                    <Badge variant={isReady ? "default" : "destructive"}>
                      {isReady ? "Available" : "Stock Shortage"}
                    </Badge>
                  </div>

                  {!isReady && (
                    <div className="text-xs text-red-700 space-y-1">
                      <p className="font-medium">Missing Items:</p>
                      <ul className="list-disc pl-4">
                        {insufficientStock.slice(0, 3).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {insufficientStock.length > 3 && (
                          <li>...and {insufficientStock.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 text-sm pt-2 border-t border-dashed border-gray-300">
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Total Output
                      </span>
                      <span className="font-bold">
                        {totalContainers.toLocaleString()} Units
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Est. Cost
                      </span>
                      <span className="font-bold">
                        PKR{" "}
                        {grandTotal.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    </div>
                    {totalCartons > 0 && (
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                          Cartons
                        </span>
                        <span className="font-bold">
                          {totalCartons.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createProductionMutation.isPending || !isReady}
                    className={cn(
                      isReady ? "bg-green-600 hover:bg-green-700" : "",
                    )}
                  >
                    {createProductionMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <PlayIcon className="mr-2 size-4" />
                    )}
                    {isReady ? "Confirm & Schedule" : "Fix Stock to Schedule"}
                  </Button>
                </div>
              </div>
            );
          }}
        </form.Subscribe>

        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel>Notes (Optional)</FieldLabel>
              <Input
                placeholder="Add any notes about this production run"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <Alert className="bg-muted/50">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Scheduling will reserve this batch. Materials are deducted when you
            click "Start" in the Run Board.
          </AlertDescription>
        </Alert>
      </FieldGroup>
    </form>
  );
};
