import React, { useMemo, useState } from "react";
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
import { PlusIcon, TrashIcon } from "lucide-react";
import {
  useCreateFormula,
  useUpdateFormula,
} from "@/hooks/manufacturing/formulas/use-formula-mutations";
import type { getFormulaByIdFn } from "@/server-functions/manufacturing/formulas/get-formula-by-id-fn";
import { useQuery } from "@tanstack/react-query";
import { getProductsFn } from "@/server-functions/inventory/get-products-fn";
import { getMaterialsFn } from "@/server-functions/inventory/get-materials-fn";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ChemicalOption, ChemicalSearchSelect } from "./chemical-search-select";
import { batchPercent, scaleQuantity, totalQuantity, typedQuantity } from "@/lib/production/formula-scale";

type Formula = NonNullable<Awaited<ReturnType<typeof getFormulaByIdFn>>>;

export function CreateFormulaDialog({
  initialFormula,
}: {
  initialFormula?: Formula;
}) {
  const [open, setOpen] = useState(false);
  const createFormula = useCreateFormula();
  const updateFormula = useUpdateFormula();
  const mutation = initialFormula ? updateFormula : createFormula;

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProductsFn({ data: undefined }),
  });

  const { data: materialsData } = useQuery({
    queryKey: ["materials"],
    queryFn: () => getMaterialsFn(),
  });

  const chemicals = materialsData?.chemicals || [];

  const availableChemicals: ChemicalOption[] = useMemo(() => {
    const list: ChemicalOption[] = (chemicals || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      unit: c.unit,
    }));
    if (initialFormula?.ingredients) {
      for (const ing of initialFormula.ingredients) {
        if (ing.chemical && !list.some((c) => c.id === ing.chemical.id)) {
          list.push({
            id: ing.chemical.id,
            name: ing.chemical.name,
            unit: ing.chemical.unit,
          });
        }
      }
    }
    return list;
  }, [chemicals, initialFormula]);

  const [productId, setProductId] = useState(initialFormula?.productId ?? "");
  const [name, setName] = useState(initialFormula?.name ?? "");
  const [batchSize, setBatchSize] = useState(
    initialFormula?.batchSize ?? "100",
  );
  const [batchUnit, setBatchUnit] = useState<"kg" | "liters">(
    initialFormula?.batchUnit === "liters" ? "liters" : "kg",
  );
  const [productionInstructions, setProductionInstructions] = useState(
    initialFormula?.productionInstructions ?? "",
  );
  const [notes, setNotes] = useState(initialFormula?.notes ?? "");
  const [ingredients, setIngredients] = useState(
    initialFormula?.ingredients.map((ingredient) => ({
      chemicalId: ingredient.chemicalId,
      ...typedQuantity(ingredient.quantityPerBatch, initialFormula.batchSize),
    })) ?? [{ chemicalId: "", ...typedQuantity("0", "100") }],
  );
  // Percentages only mean something for ingredients in the batch's own unit.
  const inBatchUnit = (chemicalId: string) =>
    availableChemicals.find((c) => c.id === chemicalId)?.unit === batchUnit;
  const chosen = ingredients.filter((ing) => ing.chemicalId);
  const total =
    chosen.length > 0 && chosen.every((ing) => inBatchUnit(ing.chemicalId))
      ? totalQuantity(chosen.map((ing) => ing.quantityPerBatch))
      : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = {
      productId,
      name,
      batchSize: Number(batchSize),
      batchUnit,
      productionInstructions: productionInstructions || null,
      notes: notes || null,
      ingredients: ingredients.map((ing) => ({
        chemicalId: ing.chemicalId,
        quantityPerBatch: Number(ing.quantityPerBatch),
      })),
    };
    const options = {
      onSuccess: () => {
        setOpen(false);
        if (!initialFormula) {
          setProductId("");
          setName("");
          setBatchSize("100");
          setBatchUnit("kg");
          setProductionInstructions("");
          setNotes("");
          setIngredients([{ chemicalId: "", ...typedQuantity("0", "100") }]);
        }
      },
    };
    if (initialFormula) {
      updateFormula.mutate(
        {
          data: {
            ...data,
            id: initialFormula.id,
            isActive: initialFormula.isActive,
          },
        },
        options,
      );
    } else createFormula.mutate({ data }, options);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="w-4 h-4 mr-2" />
          {initialFormula ? "Edit Mixing Formula" : "Create Mixing Formula"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {initialFormula ? "Edit Mixing Formula" : "Create New Mixing Formula"}
          </DialogTitle>
          <DialogDescription>
            Set bulk quantities, ingredients and mixing instructions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" htmlFor="formula-name">
                Mixing Formula Name
              </label>
              <Input
                id="formula-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Premium Dishwash Base"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="text-sm font-medium block" htmlFor="formula-product">
                Linked Product
              </label>
              <NativeSelect
                id="formula-product"
                className="w-full"
                required
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <NativeSelectOption value="" disabled>
                  Select a product
                </NativeSelectOption>
                {products?.map((p: any) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium block" htmlFor="formula-batch-size">
                Target Batch Size
              </label>
              <Input
                id="formula-batch-size"
                required
                min="0.01"
                type="number"
                step="0.01"
                value={batchSize}
                onChange={(e) => {
                  const size = e.target.value;
                  setBatchSize(size);
                  setIngredients((rows) =>
                    rows.map((row) => scaleQuantity(row, size)),
                  );
                }}
              />
              <p className="text-xs text-muted-foreground">
                Ingredient quantities change with the batch size.
              </p>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label
                className="text-sm font-medium block"
                htmlFor="formula-bulk-unit"
              >
                Bulk unit
              </label>
              <NativeSelect
                id="formula-bulk-unit"
                className="w-full"
                value={batchUnit}
                onChange={(event) =>
                  setBatchUnit(
                    event.target.value === "liters" ? "liters" : "kg",
                  )
                }
              >
                <NativeSelectOption value="kg">Kilograms</NativeSelectOption>
                <NativeSelectOption value="liters">Liters</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="formula-instructions">
                Production instructions
              </FieldLabel>
              <Textarea
                id="formula-instructions"
                value={productionInstructions}
                onChange={(event) =>
                  setProductionInstructions(event.target.value)
                }
                placeholder="Step-by-step production instructions..."
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="formula-notes">Notes</FieldLabel>
              <Textarea
                id="formula-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional notes or formulation guidelines..."
              />
            </Field>
          </FieldGroup>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-base">Ingredients</h3>
                <p className="text-xs text-muted-foreground">Add chemicals and specify quantity per batch</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setIngredients([
                    ...ingredients,
                    { chemicalId: "", ...typedQuantity("0", batchSize) },
                  ])
                }
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                Add Ingredient
              </Button>
            </div>

            <div className="space-y-2.5">
              {ingredients.map((ing, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <ChemicalSearchSelect
                      value={ing.chemicalId}
                      onChange={(chemicalId) => {
                        const newIngs = [...ingredients];
                        newIngs[index].chemicalId = chemicalId;
                        setIngredients(newIngs);
                      }}
                      chemicals={availableChemicals}
                    />
                  </div>
                  <div className="w-28 sm:w-32 shrink-0">
                    <Input
                      required
                      aria-label={`Ingredient ${index + 1} quantity`}
                      min="0.001"
                      type="number"
                      step="0.001"
                      value={ing.quantityPerBatch}
                      onChange={(e) => {
                        const newIngs = [...ingredients];
                        newIngs[index] = {
                          ...newIngs[index],
                          ...typedQuantity(e.target.value, batchSize),
                        };
                        setIngredients(newIngs);
                      }}
                      placeholder="Qty"
                    />
                  </div>
                  <span
                    className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                    aria-label={`Ingredient ${index + 1} share of batch`}
                  >
                    {(inBatchUnit(ing.chemicalId) &&
                      batchPercent(ing.quantityPerBatch, batchSize)) ||
                      "—"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      const newIngs = [...ingredients];
                      newIngs.splice(index, 1);
                      setIngredients(newIngs);
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            {total && (
              <p className="text-right text-xs tabular-nums text-muted-foreground">
                Total {total.toString()} {batchUnit} (
                {batchPercent(total, batchSize) ?? "0%"} of batch)
              </p>
            )}
          </div>

          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
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
              disabled={mutation.isPending || ingredients.length === 0}
            >
              {mutation.isPending
                ? "Saving..."
                : initialFormula
                  ? "Save Mixing Formula"
                  : "Create Mixing Formula"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
