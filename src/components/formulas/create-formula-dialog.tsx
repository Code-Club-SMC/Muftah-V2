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
      quantityPerBatch: ingredient.quantityPerBatch,
    })) ?? [{ chemicalId: "", quantityPerBatch: "0" }],
  );

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
          setIngredients([{ chemicalId: "", quantityPerBatch: "0" }]);
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialFormula ? "Edit Mixing Formula" : "Create New Mixing Formula"}
          </DialogTitle>
          <DialogDescription>
            Set bulk quantities, ingredients and mixing instructions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Mixing Formula Name
              </label>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Premium Dishwash Base"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Linked Product
              </label>
              <select
                required
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="" disabled>
                  Select a product
                </option>
                {products?.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Target Batch Size
              </label>
              <Input
                required
                min="0.01"
                type="number"
                step="0.01"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
            </div>
            <div>
              <label
                className="text-sm font-medium mb-1 block"
                htmlFor="formula-bulk-unit"
              >
                Bulk unit
              </label>
              <select
                id="formula-bulk-unit"
                className="h-10 w-full rounded-md border bg-background px-3"
                value={batchUnit}
                onChange={(event) =>
                  setBatchUnit(
                    event.target.value === "liters" ? "liters" : "kg",
                  )
                }
              >
                <option value="kg">Kilograms</option>
                <option value="liters">Liters</option>
              </select>
            </div>
          </div>

          <FieldGroup>
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
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="formula-notes">Notes</FieldLabel>
              <Textarea
                id="formula-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </FieldGroup>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-lg">Ingredients</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setIngredients([
                    ...ingredients,
                    { chemicalId: "", quantityPerBatch: "0" },
                  ])
                }
              >
                <PlusIcon className="w-4 h-4 mr-2" />
                Add Ingredient
              </Button>
            </div>

            <div className="space-y-4">
              {ingredients.map((ing, index) => (
                <div key={index} className="flex items-start gap-4">
                  <div className="flex-1">
                    <select
                      required
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={ing.chemicalId}
                      onChange={(e) => {
                        const newIngs = [...ingredients];
                        newIngs[index].chemicalId = e.target.value;
                        setIngredients(newIngs);
                      }}
                    >
                      <option value="" disabled>
                        Select chemical
                      </option>
                      {chemicals?.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-32">
                    <Input
                      required
                      aria-label={`Ingredient ${index + 1} quantity`}
                      min="0.001"
                      type="number"
                      step="0.001"
                      value={ing.quantityPerBatch}
                      onChange={(e) => {
                        const newIngs = [...ingredients];
                        newIngs[index].quantityPerBatch = e.target.value;
                        setIngredients(newIngs);
                      }}
                      placeholder="Qty"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const newIngs = [...ingredients];
                      newIngs.splice(index, 1);
                      setIngredients(newIngs);
                    }}
                  >
                    <TrashIcon className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
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
