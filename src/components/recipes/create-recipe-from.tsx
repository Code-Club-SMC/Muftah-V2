import { useState, type ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import Big from "big.js";
import type { z } from "zod";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCreateRecipe } from "@/hooks/recipes/create-recipe-hook";
import { useUpdateRecipe } from "@/hooks/recipes/use-update-recipe-hook";
import { getPackagingFormatOptionsFn } from "@/server-functions/inventory/recipes/get-packaging-format-options-fn";
import { getActiveFormulaOptionsFn } from "@/server-functions/manufacturing/formulas/get-active-formula-options-fn";
import type { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";
import { createRecipeSchema } from "@/lib/validators/validators";
import {
  getFillPerContainer,
  getPackagingTarget,
} from "@/lib/production/packaging-quantity";
import { calculatePackingLine } from "@/lib/production/batch-packing";
import {
  normalizePackagingUsageBasis,
  type PackagingUsageBasis,
} from "@/lib/recipe-packaging";

type Recipe = Awaited<ReturnType<typeof getRecipesFn>>[number];
type Props = { onOpenChange: (open: boolean) => void; initialRecipe?: Recipe };
type Payload = z.infer<typeof createRecipeSchema>;

function SetupField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {(hint || error) && (
        <FieldDescription id={`${id}-help`}>{error || hint}</FieldDescription>
      )}
    </Field>
  );
}

export function CreateRecipeForm({ onOpenChange, initialRecipe }: Props) {
  const create = useCreateRecipe();
  const update = useUpdateRecipe();
  const { data: materials } = useSuspenseQuery({
    queryKey: ["packaging-format-options"],
    queryFn: getPackagingFormatOptionsFn,
  });
  const products = materials.products;
  const { data: formulas } = useSuspenseQuery({
    queryKey: ["formulas", "active-options"],
    queryFn: () => getActiveFormulaOptionsFn(),
  });
  const [productId, setProductId] = useState(initialRecipe?.productId ?? "");
  const [formulaId, setFormulaId] = useState(initialRecipe?.formulaId ?? "");
  const [name, setName] = useState(initialRecipe?.name ?? "");
  const [fillAmount, setFillAmount] = useState(initialRecipe?.fillAmount ?? "");
  const [fillUnit, setFillUnit] = useState(initialRecipe?.fillUnit ?? "g");
  const [containerId, setContainerId] = useState(
    initialRecipe?.containerPackagingId ?? "",
  );
  const [usesCartons, setUsesCartons] = useState(
    !!initialRecipe?.cartonPackagingId,
  );
  const [cartonId, setCartonId] = useState(
    initialRecipe?.cartonPackagingId ?? "",
  );
  const [capacity, setCapacity] = useState(
    String(initialRecipe?.containersPerCarton || ""),
  );
  const [minimum, setMinimum] = useState(
    String(initialRecipe?.minimumStockLevel ?? 0),
  );
  const [extras, setExtras] = useState(
    (initialRecipe?.packaging ?? []).map((row) => ({
      packagingMaterialId: row.packagingMaterialId,
      quantity: row.quantityPerContainer,
      usageBasis: normalizePackagingUsageBasis(row.usageBasis),
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Payload | null>(null);
  const [serverError, setServerError] = useState("");
  const pending = create.isPending || update.isPending;
  const formula = formulas.find(
    (row) => row.id === formulaId && row.productId === productId,
  );
  const compatibleFormulas = formulas.filter(
    (row) => row.productId === productId,
  );
  const productName = products.find((row) => row.id === productId)?.name;
  const packMaterial = materials.packagings.find(
    (row) => row.id === containerId,
  );
  const cartonMaterial = materials.packagings.find(
    (row) => row.id === cartonId,
  );
  const control = (key: string) => ({
    id: key,
    "aria-invalid": !!errors[key],
    "aria-describedby": `${key}-help`,
  });
  let reference: { packs: number; remaining: string } | undefined;
  try {
    if (formula && fillAmount) {
      const packs = getPackagingTarget(
        formula.batchSize,
        fillAmount,
        fillUnit,
        formula.batchUnit,
      );
      reference = {
        packs,
        remaining: new Big(formula.batchSize)
          .minus(
            getFillPerContainer(fillAmount, fillUnit, formula.batchUnit).times(
              packs,
            ),
          )
          .toString(),
      };
    }
  } catch {
    /* The review step reports invalid or incompatible weights beside the field. */
  }

  function prepareReview() {
    setServerError("");
    const parsed = createRecipeSchema.safeParse({
      productId,
      formulaId,
      name: name.trim(),
      fillAmount,
      fillUnit,
      containerType: "pack",
      containerPackagingId: containerId,
      cartonPackagingId: usesCartons ? cartonId : undefined,
      containersPerCarton: usesCartons ? Number(capacity) : 0,
      batchSize: formula?.batchSize ?? "",
      batchUnit: formula?.batchUnit ?? "kg",
      targetUnitsPerBatch: reference?.packs ?? 0,
      minimumStockLevel: Number(minimum),
      additionalPackaging: extras.map((row) => ({
        packagingMaterialId: row.packagingMaterialId,
        quantityPerContainer: Number(row.quantity),
        usageBasis: row.usageBasis,
      })),
    });
    const next: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        next[String(issue.path[0])] ??= issue.message;
    if (!formula) next.formulaId = "Choose an active formula for this product.";
    if (!containerId)
      next.containerPackagingId =
        "Choose the pouch, bottle or bag used for one pack.";
    if (usesCartons && !cartonId)
      next.cartonPackagingId = "Choose a carton material.";
    if (usesCartons && (!/^\d+$/.test(capacity) || Number(capacity) < 1))
      next.containersPerCarton = "Enter a whole number of packs per carton.";
    if (!/^\d+$/.test(minimum))
      next.minimumStockLevel = "Enter a whole number, zero or more.";
    if (formula) {
      try {
        calculatePackingLine(
          { fullCartons: 0, partialPacks: 0, loosePacks: 1 },
          {
            fillAmount,
            fillUnit,
            containersPerCarton: usesCartons ? Number(capacity) : 0,
            usesCartons,
          },
          formula.batchUnit,
        );
        if (!reference || reference.packs < 1)
          next.fillAmount = "One pack must fit within the formula batch size.";
      } catch (error) {
        next.fillAmount =
          error instanceof Error
            ? error.message
            : "Check the pack weight and unit.";
      }
    }
    setErrors(next);
    if (!Object.keys(next).length && parsed.success) setReview(parsed.data);
    else
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
  }

  async function save() {
    if (!review || pending) return;
    setServerError("");
    try {
      if (initialRecipe)
        await update.mutateAsync({ data: { ...review, id: initialRecipe.id } });
      else await create.mutateAsync({ data: review });
      onOpenChange(false);
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Could not save. Your entries are still here. Try again.",
      );
    }
  }

  const summary = (
    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">Product</dt>
        <dd className="font-medium break-words">
          {productName || "Choose a product"}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Formula</dt>
        <dd className="font-medium break-words">
          {formula?.name || "Choose a formula"}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Content in one pack</dt>
        <dd className="text-xl font-semibold tabular-nums">
          {fillAmount ? `${fillAmount} ${fillUnit}` : "Enter pack size"}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Carton setup</dt>
        <dd className="text-xl font-semibold tabular-nums">
          {usesCartons
            ? `${capacity || "—"} packs / carton`
            : "Loose packs only"}
        </dd>
      </div>
    </dl>
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {review
              ? "Review packaging format"
              : initialRecipe
                ? "Edit packaging format"
                : "New packaging format"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set this up once. Operators choose it when packing a batch.
          </p>
        </div>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to formats
        </Button>
      </header>
      {initialRecipe && (
        <Alert>
          <AlertDescription>
            Formats already used for packing or stock cannot be changed. Create
            a new format when the pack size or materials change.
          </AlertDescription>
        </Alert>
      )}
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      {review ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{review.name}</CardTitle>
              <CardDescription>
                Check this against the pack used on the factory floor.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {summary}
              <div className="border-t pt-4 text-sm">
                <p>
                  Pack material: <strong>{packMaterial?.name}</strong>
                </p>
                {usesCartons && (
                  <p>
                    Carton material: <strong>{cartonMaterial?.name}</strong>
                  </p>
                )}
                {review.additionalPackaging.map((row) => (
                  <p key={row.packagingMaterialId}>
                    {
                      materials.packagings.find(
                        (material) => material.id === row.packagingMaterialId,
                      )?.name
                    }
                    : {row.quantityPerContainer}{" "}
                    {row.usageBasis === "per_carton"
                      ? "per carton"
                      : "per pack"}
                  </p>
                ))}
                <p className="mt-3 text-muted-foreground">
                  Saving a format does not produce stock. Record the actual
                  packing on the completed batch.
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setReview(null)}
            >
              Back to edit
            </Button>
            <Button disabled={pending} onClick={save}>
              <Check data-icon="inline-start" />
              {pending ? "Saving…" : "Save packaging format"}
            </Button>
          </div>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            prepareReview();
          }}
          className="flex flex-col gap-6"
        >
          <Card>
            <CardHeader>
              <CardTitle>1. Choose the product</CardTitle>
              <CardDescription>
                The formula tells us which mixed product goes into this pack.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-5 sm:grid-cols-2">
                <SetupField
                  id="productId"
                  label="Product"
                  error={errors.productId}
                >
                  <NativeSelect
                    {...control("productId")}
                    className="w-full [&_select]:h-12"
                    value={productId}
                    onChange={(event) => {
                      setProductId(event.target.value);
                      setFormulaId("");
                    }}
                  >
                    <option value="">Select product…</option>
                    {products.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </NativeSelect>
                </SetupField>
                <SetupField
                  id="formulaId"
                  label="Mixing formula"
                  error={errors.formulaId}
                  hint={
                    productId && !compatibleFormulas.length
                      ? "No active formula for this product. Ask a manager to create one first."
                      : undefined
                  }
                >
                  <NativeSelect
                    {...control("formulaId")}
                    className="w-full [&_select]:h-12"
                    disabled={!productId}
                    value={formulaId}
                    onChange={(event) => {
                      setFormulaId(event.target.value);
                      if (!fillAmount)
                        setFillUnit(
                          formulas.find((row) => row.id === event.target.value)
                            ?.batchUnit === "liters"
                            ? "ml"
                            : "g",
                        );
                    }}
                  >
                    <option value="">Select formula…</option>
                    {initialRecipe?.formulaId === formulaId && !formula && (
                      <option value={formulaId} disabled>
                        Saved formula unavailable
                      </option>
                    )}
                    {compatibleFormulas.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </NativeSelect>
                </SetupField>
              </FieldGroup>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>2. Describe one pack</CardTitle>
              <CardDescription>
                Use the name workers recognize, such as “Rs. 100 pack”. Price in
                the name is a label; pack weight drives the calculation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <SetupField id="name" label="Pack name" error={errors.name}>
                  <Input
                    {...control("name")}
                    className="h-12"
                    value={name}
                    maxLength={100}
                    placeholder="e.g. S-was Rs. 100 pack"
                    onChange={(event) => setName(event.target.value)}
                  />
                </SetupField>
                <div className="grid gap-5 sm:grid-cols-2">
                  <SetupField
                    id="fillAmount"
                    label="Content in one pack"
                    error={errors.fillAmount}
                  >
                    <Input
                      {...control("fillAmount")}
                      className="h-12"
                      inputMode="decimal"
                      placeholder="e.g. 250"
                      value={fillAmount}
                      onChange={(event) => setFillAmount(event.target.value)}
                    />
                  </SetupField>
                  <SetupField
                    id="fillUnit"
                    label="Unit"
                    error={errors.fillUnit}
                  >
                    <NativeSelect
                      {...control("fillUnit")}
                      className="w-full [&_select]:h-12"
                      value={fillUnit}
                      onChange={(event) => setFillUnit(event.target.value)}
                    >
                      <option value="g">Grams (g)</option>
                      <option value="kg">Kilograms (kg)</option>
                      <option value="ml">Millilitres (ml)</option>
                      <option value="L">Litres (L)</option>
                    </NativeSelect>
                  </SetupField>
                </div>
                <SetupField
                  id="containerPackagingId"
                  label="Pack material"
                  error={errors.containerPackagingId}
                  hint="The pouch, bottle or bag used for one retail pack."
                >
                  <NativeSelect
                    {...control("containerPackagingId")}
                    className="w-full [&_select]:h-12"
                    value={containerId}
                    onChange={(event) => setContainerId(event.target.value)}
                  >
                    <option value="">Select pack material…</option>
                    {materials.packagings
                      .filter(
                        (row) =>
                          !row.type ||
                          row.type === "primary" ||
                          row.id === containerId,
                      )
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                  </NativeSelect>
                </SetupField>
              </FieldGroup>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>3. Choose carton setup</CardTitle>
              <CardDescription>
                Carton-enabled formats can also be recorded as loose packs on a
                batch.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ToggleGroup
                type="single"
                variant="outline"
                value={usesCartons ? "cartons" : "loose"}
                onValueChange={(value) => {
                  if (value) setUsesCartons(value === "cartons");
                }}
                aria-label="Carton setup"
                className="flex-wrap"
              >
                <ToggleGroupItem value="cartons" className="h-12 px-5">
                  Use cartons
                </ToggleGroupItem>
                <ToggleGroupItem value="loose" className="h-12 px-5">
                  Loose packs only
                </ToggleGroupItem>
              </ToggleGroup>
              {usesCartons && (
                <FieldGroup className="grid gap-5 sm:grid-cols-2">
                  <SetupField
                    id="cartonPackagingId"
                    label="Carton material"
                    error={errors.cartonPackagingId}
                  >
                    <NativeSelect
                      {...control("cartonPackagingId")}
                      className="w-full [&_select]:h-12"
                      value={cartonId}
                      onChange={(event) => setCartonId(event.target.value)}
                    >
                      <option value="">Select carton…</option>
                      {materials.packagings
                        .filter(
                          (row) => row.type === "master" || row.id === cartonId,
                        )
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </SetupField>
                  <SetupField
                    id="containersPerCarton"
                    label="Packs in one full carton"
                    error={errors.containersPerCarton}
                    hint="Enter the actual capacity, for example 40."
                  >
                    <Input
                      {...control("containersPerCarton")}
                      className="h-12"
                      inputMode="numeric"
                      placeholder="e.g. 40"
                      value={capacity}
                      onChange={(event) => setCapacity(event.target.value)}
                    />
                  </SetupField>
                </FieldGroup>
              )}
            </CardContent>
          </Card>
          <details
            className="rounded-xl border p-5"
            open={
              errors.additionalPackaging || errors.minimumStockLevel
                ? true
                : undefined
            }
          >
            <summary className="cursor-pointer font-medium">
              Optional: labels, caps and stock alert
            </summary>
            <FieldGroup className="mt-5">
              <p className="text-sm text-muted-foreground">
                Add only materials needed in addition to the pack and carton
                above.
              </p>
              {extras.map((row, index) => (
                <div
                  key={index}
                  className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_100px_150px_auto]"
                >
                  <SetupField id={`extra-${index}`} label="Extra material">
                    <NativeSelect
                      id={`extra-${index}`}
                      className="w-full [&_select]:h-12"
                      value={row.packagingMaterialId}
                      onChange={(event) =>
                        setExtras(
                          extras.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  packagingMaterialId: event.target.value,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">Select material…</option>
                      {materials.packagings.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </SetupField>
                  <SetupField id={`quantity-${index}`} label="Quantity">
                    <Input
                      id={`quantity-${index}`}
                      className="h-12"
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(event) =>
                        setExtras(
                          extras.map((item, i) =>
                            i === index
                              ? { ...item, quantity: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </SetupField>
                  <SetupField id={`basis-${index}`} label="Used for">
                    <NativeSelect
                      id={`basis-${index}`}
                      className="w-full [&_select]:h-12"
                      value={row.usageBasis}
                      onChange={(event) =>
                        setExtras(
                          extras.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  usageBasis: event.target
                                    .value as PackagingUsageBasis,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="per_unit">Each pack</option>
                      <option value="per_carton">Each carton</option>
                    </NativeSelect>
                  </SetupField>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Remove extra material ${index + 1}`}
                    onClick={() =>
                      setExtras(extras.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {errors.additionalPackaging && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.additionalPackaging}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() =>
                  setExtras([
                    ...extras,
                    {
                      packagingMaterialId: "",
                      quantity: "1",
                      usageBasis: "per_unit",
                    },
                  ])
                }
              >
                <Plus data-icon="inline-start" />
                Add extra material
              </Button>
              <SetupField
                id="minimumStockLevel"
                label="Low stock alert at (packs)"
                error={errors.minimumStockLevel}
                hint="Zero means no minimum stock target."
              >
                <Input
                  {...control("minimumStockLevel")}
                  className="h-12 max-w-48"
                  inputMode="numeric"
                  value={minimum}
                  onChange={(event) => setMinimum(event.target.value)}
                />
              </SetupField>
            </FieldGroup>
          </details>
          <Card>
            <CardHeader>
              <CardTitle>Your pack at a glance</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {summary}
              {formula && reference && (
                <p className="border-t pt-4 text-sm text-muted-foreground">
                  Reference only: {formula.batchSize} {formula.batchUnit} makes{" "}
                  {reference.packs.toLocaleString()} whole packs, leaving{" "}
                  {reference.remaining} {formula.batchUnit}. Actual packing is
                  recorded on the batch.
                </p>
              )}
            </CardContent>
          </Card>
          {Object.keys(errors).length > 0 && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                Check the highlighted fields before reviewing.
              </AlertDescription>
            </Alert>
          )}
          <div className="sticky bottom-0 flex justify-end border-t bg-background py-4">
            <Button type="submit" className="h-12 px-6">
              Review packaging format
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
