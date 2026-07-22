import { useForm, useStore } from "@tanstack/react-form";
import {
  Loader2,
  Plus,
  Trash2,
  Package,
  Info,
  CheckCircle2,
  AlertTriangle,
  FlaskConical,
  X,
  Save,
  Calculator,
  RefreshCw,
  Scale,
  ArrowRight,
  ListPlusIcon,
  ChevronRight,
  Beaker,
  Boxes,
  TrendingUp,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { toast } from "sonner";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useCreateRecipe } from "@/hooks/recipes/create-recipe-hook";
import { getProductsFn } from "@/server-functions/inventory/get-products-fn";
import { getMaterialsFn } from "@/server-functions/inventory/get-materials-fn";
import { useState, useMemo, useEffect, useRef } from "react";
import { getWarehousesFn } from "@/server-functions/inventory/get-warehouses-fn";
import { Badge } from "../ui/badge";
import { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";
import { useUpdateRecipe } from "@/hooks/recipes/use-update-recipe-hook";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "../ui/card";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  createRecipeSchema,
  ingredientSelectionSchema,
  additionalPackagingItemSchema,
} from "@/lib/recipe-validators";
import {
  getPlannedPackagingQuantity,
  normalizePackagingUsageBasis,
  type PackagingUsageBasis,
} from "@/lib/recipe-packaging";

type Recipe = Awaited<ReturnType<typeof getRecipesFn>>[number];

type Props = {
  onOpenChange: (open: boolean) => void;
  initialRecipe?: Recipe;
};

const convertToBase = (
  value: number,
  unit: string,
): { val: number; type: "mass" | "volume" } => {
  switch (unit) {
    case "kg": return { val: value, type: "mass" };
    case "g": return { val: value / 1000, type: "mass" };
    case "liters":
    case "L": return { val: value, type: "volume" };
    case "ml": return { val: value / 1000, type: "volume" };
    default: return { val: value, type: "mass" };
  }
};

const formatNumber = (num: number | string) => {
  if (!num) return "";
  return parseFloat(num.toString()).toString();
};

// ── Mini bar for cost distribution ────────────────────────────────────────────
function CostBar({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.min((value / total) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-700", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Stock status row ───────────────────────────────────────────────────────────
function StockIndicator({
  current,
  needed,
  unit,
}: {
  current: number;
  needed: number;
  unit?: string;
}) {
  const sufficient = current >= needed;
  const pct = needed > 0 ? Math.min((current / needed) * 100, 100) : 100;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">
          Stock: <span className="font-semibold text-foreground">{current.toLocaleString()}</span>{unit ? ` ${unit}` : ""}
        </span>
        <span className={cn("font-semibold", sufficient ? "text-emerald-600" : "text-destructive")}>
          {sufficient ? `+${(current - needed).toLocaleString()} left` : `${(needed - current).toLocaleString()} short`}
        </span>
      </div>
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", sufficient ? "bg-emerald-500" : "bg-destructive")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({
  step,
  icon: Icon,
  title,
  description,
  badge,
}: {
  step?: number;
  icon: React.ElementType;
  title: string;
  description?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 shrink-0">
        {step ? (
          <span className="text-xs font-bold text-primary">{step}</span>
        ) : (
          <Icon className="size-4 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {badge}
    </div>
  );
}

export const CreateRecipeForm = ({ onOpenChange, initialRecipe }: Props) => {
  const createRecipeMutation = useCreateRecipe();
  const updateRecipeMutation = useUpdateRecipe();

  const { data: products } = useSuspenseQuery({ queryKey: ["products"], queryFn: getProductsFn });
  const { data: materials } = useSuspenseQuery({ queryKey: ["materials"], queryFn: getMaterialsFn });
  const { data: warehouses } = useSuspenseQuery({ queryKey: ["warehouses"], queryFn: getWarehousesFn });

  const [tempMaterialId, setTempMaterialId] = useState<string>("");
  const [tempPackagingId, setTempPackagingId] = useState<string>("");
  const [tempIngQty, setTempIngQty] = useState("");
  const [tempPkgQty, setTempPkgQty] = useState("1");
  const [cartonsCount, setCartonsCount] = useState<number>(0);
  const [tempPkgUnit, setTempPkgUnit] = useState<PackagingUsageBasis>("per_unit");

  const form = useForm({
    defaultValues: {
      productId: initialRecipe?.productId || "",
      name: initialRecipe?.name || "",
      batchSize: initialRecipe?.batchSize ? formatNumber(initialRecipe.batchSize) : "",
      batchUnit: (initialRecipe?.batchUnit as "kg" | "liters") || "liters",
      fillAmount: initialRecipe?.fillAmount ? formatNumber(initialRecipe.fillAmount) : "",
      fillUnit: (initialRecipe?.fillUnit as "g" | "kg" | "ml" | "L") || (initialRecipe?.batchUnit === "kg" ? "g" : "ml"),
      containerType: (initialRecipe?.containerType as "pack") || "pack",
      containerPackagingId: initialRecipe?.containerPackagingId || "",
      containersPerCarton: initialRecipe?.containersPerCarton || 0,
      cartonPackagingId: initialRecipe?.cartonPackagingId || "",
      minimumStockLevel: initialRecipe?.minimumStockLevel || 0,
      producedUnits: initialRecipe?.targetUnitsPerBatch || 0,
      ingredients: initialRecipe?.ingredients.map((ing) => ({
        chemicalId: ing.chemicalId,
        quantityPerBatch: formatNumber(ing.quantityPerBatch),
      })) || [],
      additionalPackaging: (initialRecipe?.packaging || []).map((pkg: any) => ({
        packagingMaterialId: pkg.packagingMaterialId,
        quantityPerContainer: Number(pkg.quantityPerContainer) || 1,
        usageBasis: normalizePackagingUsageBasis(pkg.usageBasis),
      })) || [],
    },
    onSubmit: async ({ value }) => {
      try {
        const validationResult = createRecipeSchema.safeParse(value);
        if (!validationResult.success) {
          toast.error(validationResult.error.issues[0]?.message || "Validation failed");
          return;
        }
        const recipeData = {
          productId: value.productId,
          name: value.name,
          batchSize: value.batchSize,
          batchUnit: value.batchUnit,
          fillAmount: value.fillAmount,
          fillUnit: value.fillUnit,
          targetUnitsPerBatch: value.producedUnits,
          containerType: value.containerType,
          containerPackagingId: value.containerPackagingId,
          containersPerCarton: value.containersPerCarton,
          cartonPackagingId: value.cartonPackagingId || undefined,
          minimumStockLevel: value.minimumStockLevel,
          ingredients: value.ingredients,
          additionalPackaging: value.additionalPackaging,
        };
        if (initialRecipe) {
          await updateRecipeMutation.mutateAsync({ data: { ...recipeData, id: initialRecipe.id } });
        } else {
          await createRecipeMutation.mutateAsync({ data: recipeData });
        }
        onOpenChange(false);
      } catch (error) {
        console.error("Recipe submission error:", error);
      }
    },
  });

  const values = useStore(form.store, (state) => state.values);

  const primaryPackagings = useMemo(() => materials.packagings.filter((p) => !p.type || p.type === "primary"), [materials.packagings]);
  const masterPackagings = useMemo(() => materials.packagings.filter((p) => p.type === "master"), [materials.packagings]);
  const selectedContainer = useMemo(() => materials.packagings.find((c) => c.id === values.containerPackagingId), [values.containerPackagingId, materials.packagings]);
  const selectedCarton = useMemo(() => materials.packagings.find((c) => c.id === values.cartonPackagingId), [values.cartonPackagingId, materials.packagings]);

  useEffect(() => {
    if (initialRecipe?.targetUnitsPerBatch && initialRecipe?.containersPerCarton) {
      setCartonsCount(Math.ceil(initialRecipe.targetUnitsPerBatch / initialRecipe.containersPerCarton));
    }
  }, [initialRecipe]);

  useEffect(() => {
    if (selectedCarton?.capacity) {
      form.setFieldValue("containersPerCarton", parseFloat(selectedCarton.capacity));
      return;
    }
    if (values.producedUnits > 0 && cartonsCount > 0) {
      const cap = Math.floor(values.producedUnits / cartonsCount);
      if (values.containersPerCarton !== cap) form.setFieldValue("containersPerCarton", cap);
    }
  }, [cartonsCount, values.producedUnits, form, selectedCarton]);

  useEffect(() => {
    if (!tempPackagingId) return;
    const mat = materials.packagings.find((p) => p.id === tempPackagingId);
    if (mat?.type === "sticker") {
      setTempPkgQty("1");
      setTempPkgUnit("per_carton");
    } else if (tempPkgQty === "" || tempPkgQty === "0") {
      setTempPkgQty("1");
      setTempPkgUnit("per_unit");
    }
  }, [tempPackagingId, materials.packagings, cartonsCount]);

  useEffect(() => {
    if (selectedContainer) {
      if (selectedContainer.capacity) form.setFieldValue("fillAmount", selectedContainer.capacity);
      if (selectedContainer.capacityUnit) form.setFieldValue("fillUnit", selectedContainer.capacityUnit as "ml" | "L" | "g" | "kg");
    } else {
      form.setFieldValue("fillAmount", "");
      form.setFieldValue("fillUnit", "ml");
    }
  }, [selectedContainer, form]);

  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    if (selectedCarton?.capacity && values.producedUnits > 0) {
      const definedCapacity = parseFloat(selectedCarton.capacity);
      const neededCartons = Math.ceil(values.producedUnits / definedCapacity);
      if (cartonsCount !== neededCartons) {
        setCartonsCount(neededCartons);
        const isInitializing = Date.now() - mountTimeRef.current < 500;
        if (!isInitializing) {
          toast.info(`Carton count adjusted to ${neededCartons} (${definedCapacity} units/box)`);
        }
      }
    }
  }, [selectedCarton, values.producedUnits]);

  const massBalance = useMemo(() => {
    const batchSize = parseFloat(values.batchSize) || 0;
    const fillAmount = parseFloat(values.fillAmount) || 0;
    const targetUnits = values.producedUnits || 0;
    if (!batchSize || !fillAmount || !targetUnits) return null;
    const batch = convertToBase(batchSize, values.batchUnit);
    const fill = convertToBase(fillAmount, values.fillUnit);
    const totalFillingMass = fill.val * targetUnits;
    const discrepancy = batch.val - totalFillingMass;
    const efficiency = (totalFillingMass / batch.val) * 100;
    const isStrictlyBalanced = efficiency >= 99 && efficiency <= 101;
    const isUnitMismatch = Math.abs(efficiency - 0.1) < 0.05;
    const suggestedPacks = Math.round(batch.val / fill.val);
    const suggestedFill = batch.val / targetUnits;
    let displaySuggestedFill = suggestedFill;
    if (values.fillUnit === "g" || values.fillUnit === "ml") displaySuggestedFill *= 1000;
    return {
      batchBase: batch.val,
      fillBase: fill.val,
      totalFillingMass,
      discrepancy,
      efficiency,
      matchType: batch.type === fill.type,
      suggestedPacks,
      suggestedFill: displaySuggestedFill,
      suggestedBatch: totalFillingMass,
      isUnitMismatch,
      isStrictlyBalanced,
    };
  }, [values.batchSize, values.batchUnit, values.fillAmount, values.fillUnit, values.producedUnits]);

  const ingredientsCost = useMemo(() => values.ingredients.reduce((total, ing) => {
    const material = materials.chemicals.find((m) => m.id === ing.chemicalId);
    if (!material) return total;
    return total + parseFloat(material.costPerUnit?.toString() || "0") * parseFloat(ing.quantityPerBatch || "0");
  }, 0), [values.ingredients, materials.chemicals]);

  const containersCost = useMemo(() => {
    if (!selectedContainer) return 0;
    return (values.producedUnits || 0) * parseFloat(selectedContainer.costPerUnit?.toString() || "0");
  }, [selectedContainer, values.producedUnits]);

  const cartonsCalculation = useMemo(() => {
    if (!selectedCarton) return { boxesNeeded: 0, cost: 0 };
    return { boxesNeeded: cartonsCount, cost: cartonsCount * parseFloat(selectedCarton.costPerUnit?.toString() || "0") };
  }, [selectedCarton, cartonsCount]);

  const additionalPackagingCost = useMemo(() => values.additionalPackaging.reduce((total, pkg) => {
    const material = materials.packagings.find((m) => m.id === pkg.packagingMaterialId);
    if (!material) return total;
    const totalQty = getPlannedPackagingQuantity({
      quantityPerContainer: pkg.quantityPerContainer,
      usageBasis: pkg.usageBasis,
      targetUnits: values.producedUnits || 0,
      containersPerCarton: values.containersPerCarton,
    });
    return total + parseFloat(material.costPerUnit?.toString() || "0") * totalQty;
  }, 0), [values.additionalPackaging, materials.packagings, values.producedUnits, values.containersPerCarton]);

  const totalCost = ingredientsCost + containersCost + cartonsCalculation.cost + additionalPackagingCost;
  const costPerUnit = values.producedUnits > 0 ? totalCost / values.producedUnits : 0;

  const handleAddIngredient = () => {
    if (!tempMaterialId || !tempIngQty) { toast.error("Select an ingredient and enter a quantity"); return; }
    const material = materials.chemicals.find((m) => m.id === tempMaterialId);
    const validationResult = ingredientSelectionSchema.safeParse({ chemicalId: tempMaterialId, quantityPerBatch: tempIngQty });
    if (!validationResult.success) { toast.error(validationResult.error.issues[0].message); return; }
    if (values.ingredients.some((ing) => ing.chemicalId === tempMaterialId)) {
      toast.error(`${material?.name} is already added.`); return;
    }
    form.setFieldValue("ingredients", [...values.ingredients, validationResult.data]);
    setTempMaterialId(""); setTempIngQty("");
  };

  const handleUpdateIngredient = (index: number, quantity: string) => {
    const newIngredients = [...values.ingredients];
    newIngredients[index] = { ...newIngredients[index], quantityPerBatch: quantity };
    form.setFieldValue("ingredients", newIngredients);
  };

  const handleRemoveIngredient = (index: number) => {
    form.setFieldValue("ingredients", values.ingredients.filter((_, i) => i !== index));
  };

  const handleAddAdditionalPackaging = () => {
    if (!tempPackagingId || !tempPkgQty) return;
    if (tempPkgUnit === "per_carton" && cartonsCount <= 0) {
      toast.error("Configure carton packaging before adding carton-based materials.");
      return;
    }
    const qty = parseFloat(tempPkgQty);
    const validationResult = additionalPackagingItemSchema.safeParse({
      packagingMaterialId: tempPackagingId,
      quantityPerContainer: qty,
      usageBasis: tempPkgUnit,
    });
    if (!validationResult.success) { toast.error(validationResult.error.issues[0].message); return; }
    if (values.additionalPackaging.some((pkg) => pkg.packagingMaterialId === tempPackagingId)) { toast.error("Item already added."); return; }
    form.setFieldValue("additionalPackaging", [...values.additionalPackaging, validationResult.data]);
    setTempPackagingId(""); setTempPkgQty("1");
  };

  const handleRemoveAdditionalPackaging = (index: number) => {
    form.setFieldValue("additionalPackaging", values.additionalPackaging.filter((_, i) => i !== index));
  };

  const getStockStatus = (materialId: string, type: "chemical" | "packaging", neededQty: number) => {
    const material = type === "chemical"
      ? materials.chemicals.find((m) => m.id === materialId)
      : materials.packagings.find((m) => m.id === materialId);
    if (!material) return { available: false, current: 0, remaining: 0 };
    const totalStock = material.stock?.reduce((sum, s) => {
      const wh = warehouses.find((w) => w.id === s.warehouseId);
      return wh?.isActive ? sum + parseFloat(s.quantity.toString()) : sum;
    }, 0) || 0;
    return { available: totalStock >= neededQty, current: totalStock, remaining: totalStock - neededQty };
  };

  const isSaving = createRecipeMutation.isPending || updateRecipeMutation.isPending;
  const hasLooseUnits = cartonsCount > 0 && values.producedUnits > 0 && values.containersPerCarton > 0 && values.producedUnits % values.containersPerCarton !== 0;

  return (
    <div className="flex flex-col h-full bg-muted/10">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FlaskConical className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-bold">
              {initialRecipe ? "Edit Recipe" : "New Recipe"}
            </h1>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">
              Batch parameters, formulation & packaging
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-muted-foreground">
            <X className="size-4 mr-1.5" /> Cancel
          </Button>
          <Button onClick={() => form.handleSubmit()} disabled={isSaving} className="min-w-[130px] gap-2">
            {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {isSaving ? "Saving…" : initialRecipe ? "Save Changes" : "Create Recipe"}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 max-w-[1400px] mx-auto">

            {/* ═══════════════════════════════════════════════════════════════
                LEFT — CONFIGURATION
            ══════════════════════════════════════════════════════════════════ */}
            <div className="space-y-5">

              {/* ── SECTION 1: Batch Fundamentals ─────────────────────────── */}
              <Card className="border-border/50">
                <CardHeader className="px-5 py-4 border-b border-border/40">
                  <SectionHeader
                    step={1}
                    icon={Info}
                    title="Batch Fundamentals"
                    description="Define the core production parameters for this recipe"
                  />
                </CardHeader>
                <CardContent className="p-5 space-y-5">

                  {/* Mass balance notification */}
                  {massBalance && (massBalance.discrepancy > 0.01 || massBalance.discrepancy < -0.01) && (
                    <div className={cn(
                      "rounded-xl border p-4 space-y-3 transition-all",
                      massBalance.isStrictlyBalanced
                        ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900"
                        : "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900",
                    )}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Scale className={cn("size-4", massBalance.isStrictlyBalanced ? "text-emerald-600" : "text-amber-600")} />
                          <span className={cn("text-xs font-semibold", massBalance.isStrictlyBalanced ? "text-emerald-700" : "text-amber-700")}>
                            Yield Analysis
                          </span>
                        </div>
                        <span className={cn(
                          "text-xs font-mono font-bold px-2 py-0.5 rounded-full",
                          massBalance.isStrictlyBalanced
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
                        )}>
                          {formatNumber(massBalance.efficiency.toFixed(1))}% efficient
                        </span>
                      </div>

                      {/* Efficiency bar */}
                      <div className="space-y-1.5">
                        <div className="h-2 bg-black/10 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-500",
                              massBalance.isStrictlyBalanced ? "bg-emerald-500" : "bg-amber-500"
                            )}
                            style={{ width: `${Math.min(massBalance.efficiency, 100)}%` }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/50 dark:bg-black/20 rounded-lg p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Batch Input</p>
                            <p className="text-base font-bold font-mono">{formatNumber(massBalance.batchBase)} <span className="text-xs font-medium text-muted-foreground">{values.batchUnit}</span></p>
                          </div>
                          <div className="bg-white/50 dark:bg-black/20 rounded-lg p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Packed Output</p>
                            <p className="text-base font-bold font-mono">{formatNumber(massBalance.totalFillingMass.toFixed(3))} <span className="text-xs font-medium text-muted-foreground">{values.batchUnit}</span></p>
                          </div>
                        </div>
                      </div>

                      {(!massBalance.isStrictlyBalanced || massBalance.isUnitMismatch) && (
                        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                          <div className="space-y-1.5">
                            <p>Yield outside 99–101% tolerance.{massBalance.isUnitMismatch ? " Possible unit mismatch (g vs kg)." : " Verify batch inputs."}</p>
                            {massBalance.isUnitMismatch && (
                              <Button variant="outline" size="sm" className="h-7 text-xs border-amber-300 bg-white hover:bg-amber-50"
                                onClick={() => { form.setFieldValue("batchSize", formatNumber(massBalance.suggestedBatch)); toast.success("Batch size corrected."); }}>
                                Fix to {formatNumber(massBalance.suggestedBatch)} {values.batchUnit}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Core fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <form.Field name="productId">
                      {(field) => (
                        <Field className="space-y-1.5">
                          <FieldLabel className="text-xs font-medium text-muted-foreground">Target product</FieldLabel>
                          <Select value={field.state.value} onValueChange={field.handleChange}>
                            <SelectTrigger className={cn("h-10 bg-background", field.state.meta.errors.length && "border-destructive")}>
                              <SelectValue placeholder="Select product…" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>

                    <form.Field name="name">
                      {(field) => (
                        <Field className="space-y-1.5">
                          <FieldLabel className="text-xs font-medium text-muted-foreground">Recipe name</FieldLabel>
                          <Input
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="e.g. Standard Summer Batch"
                            className={cn("h-10", field.state.meta.errors.length && "border-destructive")}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>

                    {/* Batch size + unit */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Total batch size</label>
                      <div className="flex gap-2">
                        <form.Field name="batchSize">
                          {(field) => (
                            <Input
                              type="number"
                              placeholder="0.00"
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              className={cn("flex-1 h-10 font-mono font-semibold text-base", field.state.meta.errors.length && "border-destructive")}
                              step="0.01"
                            />
                          )}
                        </form.Field>
                        <form.Field name="batchUnit">
                          {(field) => (
                            <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as "kg" | "liters")}>
                              <SelectTrigger className="w-24 h-10 bg-muted/40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="liters">Liters</SelectItem>
                                <SelectItem value="kg">Kg</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </form.Field>
                      </div>
                    </div>

                    <form.Field name="producedUnits">
                      {(field) => (
                        <Field className="space-y-1.5">
                          <FieldLabel className="text-xs font-medium text-muted-foreground">Target yield (units)</FieldLabel>
                          <Input
                            type="number"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                            className="h-10 font-mono font-semibold text-base"
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>

                    <form.Field name="minimumStockLevel">
                      {(field) => (
                        <Field className="space-y-1.5">
                          <FieldLabel className="text-xs font-medium text-muted-foreground">Low stock alert (units)</FieldLabel>
                          <Input
                            type="number"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                            placeholder="1000"
                            className="h-10 font-mono font-semibold"
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>
                  </div>
                </CardContent>
              </Card>

              {/* ── SECTION 2: Chemical Formulation ───────────────────────── */}
              <Card className="border-border/50">
                <CardHeader className="px-5 py-4 border-b border-border/40">
                  <SectionHeader
                    step={2}
                    icon={Beaker}
                    title="Chemical Formulation"
                    description="Add raw material ingredients and their quantities per batch"
                    badge={
                      values.ingredients.length > 0 && (
                        <Badge variant="secondary" className="font-mono text-xs">
                          {values.ingredients.length} items
                        </Badge>
                      )
                    }
                  />
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  {/* Add row */}
                  <div className="flex gap-2 p-3 bg-primary/5 rounded-xl border border-primary/10">
                    <Select value={tempMaterialId} onValueChange={setTempMaterialId}>
                      <SelectTrigger className="flex-1 bg-background h-9 text-sm">
                        <SelectValue placeholder="Select chemical…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[280px]">
                        {materials.chemicals
                          .filter((c) => !values.ingredients.some((i) => i.chemicalId === c.id))
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              <div className="flex items-center justify-between w-full gap-4">
                                <span>{c.name}</span>
                                <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                                  PKR {c.costPerUnit}/{c.unit}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <div className="relative w-28">
                      <Input
                        type="number"
                        placeholder="Qty"
                        className="w-full h-9 font-mono font-bold pr-1 text-primary text-base"
                        value={tempIngQty}
                        onChange={(e) => setTempIngQty(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddIngredient()}
                        step="0.01"
                      />
                    </div>
                    <Button onClick={handleAddIngredient} size="sm" className="h-9 w-9 p-0 shrink-0">
                      <Plus className="size-4" />
                    </Button>
                  </div>

                  {/* Ingredient list */}
                  <div className="space-y-2">
                    {values.ingredients.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center border-2 border-dashed rounded-xl text-muted-foreground">
                        <FlaskConical className="size-8 mb-2 opacity-30" />
                        <p className="text-sm font-medium">No ingredients yet</p>
                        <p className="text-xs mt-0.5">Select a chemical above to start building your formula</p>
                      </div>
                    ) : (
                      values.ingredients.map((ing, idx) => {
                        const material = materials.chemicals.find((m) => m.id === ing.chemicalId);
                        const qty = parseFloat(ing.quantityPerBatch);
                        const stock = getStockStatus(ing.chemicalId, "chemical", qty);
                        return (
                          <div key={`${ing.chemicalId}-${idx}`}
                            className="group flex items-start gap-3 p-3.5 rounded-xl border border-border/50 bg-background hover:border-primary/30 hover:bg-primary/2 transition-all">
                            <div className="flex-1 space-y-2 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm truncate">{material?.name}</span>
                                <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                                  PKR {material?.costPerUnit}/{material?.unit}
                                </span>
                              </div>
                              <StockIndicator current={stock.current} needed={qty} unit={material?.unit} />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="relative">
                                <Input
                                  className="w-24 h-9 text-right pr-9 text-sm font-mono font-bold text-primary"
                                  value={ing.quantityPerBatch}
                                  type="number"
                                  onChange={(e) => handleUpdateIngredient(idx, e.target.value)}
                                  step="0.01"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-medium pointer-events-none">
                                  {material?.unit}
                                </div>
                              </div>
                              <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleRemoveIngredient(idx)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ── SECTION 3: Packaging & Distribution ───────────────────── */}
              <Card className="border-border/50">
                <CardHeader className="px-5 py-4 border-b border-border/40">
                  <SectionHeader
                    step={3}
                    icon={Package}
                    title="Packaging & Distribution"
                    description="Configure primary container, master carton, and additional materials"
                  />
                </CardHeader>
                <CardContent className="p-5 space-y-5">

                  {/* ── Primary container ─────────────────────────────────── */}
                  <div className="rounded-xl border border-border/60 overflow-hidden">
                    <div className="px-4 py-3 bg-muted/30 border-b border-border/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-5 rounded-md bg-primary/15 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-primary">A</span>
                        </div>
                        <span className="text-xs font-semibold">Primary Container</span>
                      </div>
                      {selectedContainer && (
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>PKR {selectedContainer.costPerUnit} / unit</span>
                          <span className="text-border">·</span>
                          <span>Stock: {getStockStatus(selectedContainer.id, "packaging", 0).current.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-4">
                      <form.Field name="containerPackagingId">
                        {(field) => (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Container material</label>
                            <div className="flex gap-2">
                              <Select value={field.state.value} onValueChange={field.handleChange}>
                                <SelectTrigger className={cn("flex-1 h-10 bg-background", field.state.meta.errors.length && "border-destructive")}>
                                  <SelectValue placeholder="Select container…" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[280px]">
                                  {primaryPackagings.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      <div className="flex flex-col py-0.5">
                                        <span className="font-medium">{p.name}</span>
                                        {p.capacity && <span className="text-[10px] text-muted-foreground">{parseInt(p.capacity).toFixed(0)}{p.capacityUnit} capacity</span>}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {values.containerPackagingId && (
                                <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => form.setFieldValue("containerPackagingId", "")}>
                                  <X className="size-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </form.Field>

                      <div className="grid grid-cols-2 gap-3">
                        <form.Field name="fillAmount">
                          {(field) => (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Fill amount per unit</label>
                              <Input
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder="0.00"
                                step="0.01"
                                readOnly={!!selectedContainer?.capacity}
                                disabled={!selectedContainer || !!selectedContainer.capacity}
                                className={cn("h-10 font-mono", selectedContainer?.capacity && "bg-muted/50 text-muted-foreground")}
                              />
                            </div>
                          )}
                        </form.Field>
                        <form.Field name="fillUnit">
                          {(field) => (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Unit</label>
                              <Select
                                value={field.state.value}
                                onValueChange={(v) => field.handleChange(v as "ml" | "L" | "g" | "kg")}
                                disabled={!selectedContainer || !!selectedContainer.capacityUnit}
                              >
                                <SelectTrigger className={cn("h-10", selectedContainer?.capacityUnit && "bg-muted/50 text-muted-foreground")}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ml">ml (Milliliters)</SelectItem>
                                  <SelectItem value="L">L (Liters)</SelectItem>
                                  <SelectItem value="g">g (Grams)</SelectItem>
                                  <SelectItem value="kg">kg (Kilograms)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </form.Field>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-border/40">
                        <span className="text-xs text-muted-foreground">Quantity needed</span>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            className="w-20 h-8 text-xs font-mono font-bold text-center"
                            value={values.producedUnits || ""}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              form.setFieldValue("producedUnits", isNaN(val) ? 0 : val);
                            }}
                            placeholder="0"
                          />
                          <span className="text-xs text-muted-foreground">units</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Master carton ──────────────────────────────────────── */}
                  <div className="rounded-xl border border-border/60 overflow-hidden">
                    <div className="px-4 py-3 bg-muted/30 border-b border-border/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="size-5 rounded-md bg-muted flex items-center justify-center">
                          <span className="text-[10px] font-bold text-muted-foreground">B</span>
                        </div>
                        <span className="text-xs font-semibold">Master Carton</span>
                        <span className="text-[10px] text-muted-foreground">(optional)</span>
                      </div>
                      {selectedCarton && (
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>PKR {selectedCarton.costPerUnit} / carton</span>
                          <span className="text-border">·</span>
                          <span>Stock: {getStockStatus(selectedCarton.id, "packaging", 0).current.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="grid grid-cols-[1fr_120px] gap-3 items-end">
                        <form.Field name="cartonPackagingId">
                          {(field) => (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Carton type</label>
                              <Select value={field.state.value} onValueChange={field.handleChange}>
                                <SelectTrigger className="h-10 bg-background">
                                  <SelectValue placeholder="No carton (loose)" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none" className="italic text-muted-foreground">No carton (loose units)</SelectItem>
                                  {masterPackagings.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}{p.capacity ? ` — ${formatNumber(p.capacity)} units` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </form.Field>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">Total cartons</label>
                          <Input
                            type="number"
                            value={cartonsCount}
                            onChange={(e) => setCartonsCount(parseInt(e.target.value) || 0)}
                            className="h-10 font-mono font-bold text-center"
                            disabled={!values.cartonPackagingId || values.cartonPackagingId === "_none"}
                            placeholder="—"
                          />
                        </div>
                      </div>

                      {values.cartonPackagingId && values.cartonPackagingId !== "_none" && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <form.Field name="containersPerCarton">
                              {(field) => (
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Units per carton</label>
                                  <Input value={field.state.value || ""} readOnly disabled className="h-9 bg-muted/50 font-mono font-bold" placeholder="Auto" />
                                </div>
                              )}
                            </form.Field>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Carton label</label>
                              <Input value={selectedCarton?.capacityUnit || "units"} readOnly disabled className="h-9 bg-muted/50" />
                            </div>
                          </div>

                          {selectedCarton?.capacity ? (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                              <CheckCircle2 className="size-3.5" />
                              <span>Perfect fit — {formatNumber(selectedCarton.capacity)} units per carton</span>
                            </div>
                          ) : (cartonsCount > 0 && values.producedUnits > 0 && (
                            <p className="text-xs text-muted-foreground">
                              ≈ {Math.floor(values.producedUnits / cartonsCount)} units per carton
                            </p>
                          ))}

                          {/* Loose units warning */}
                          {hasLooseUnits && (
                            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3.5 space-y-2">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
                                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Uneven distribution</span>
                              </div>
                              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                                {values.producedUnits} units ÷ {values.containersPerCarton} ={" "}
                                <strong>{Math.floor(values.producedUnits / values.containersPerCarton)} full cartons</strong>
                                {" + "}
                                <strong>{values.producedUnits % values.containersPerCarton} loose</strong>.{" "}
                                The operator will choose how to handle the remainder at packing time.
                              </p>
                            </div>
                          )}

                          <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
                            onClick={() => { form.setFieldValue("cartonPackagingId", ""); setCartonsCount(0); }}>
                            <X className="size-3 mr-1" /> Remove carton
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Additional materials ───────────────────────────────── */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ListPlusIcon className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Additional Materials</span>
                      </div>
                      {values.additionalPackaging.length > 0 && (
                        <Badge variant="secondary" className="font-mono text-xs">{values.additionalPackaging.length}</Badge>
                      )}
                    </div>

                    {/* Add row */}
                    <div className="flex gap-2 p-3 bg-muted/20 rounded-xl border border-border/40">
                      <Select value={tempPackagingId} onValueChange={setTempPackagingId}>
                        <SelectTrigger className="flex-1 bg-background h-9 text-sm">
                          <SelectValue placeholder="Add sticker or extra…" />
                        </SelectTrigger>
                        <SelectContent>
                          {materials.packagings
                            .filter((p) => !p.type || p.type === "sticker" || p.type === "extra")
                            .filter((p) => p.id !== values.containerPackagingId && p.id !== values.cartonPackagingId)
                            .filter((p) => !values.additionalPackaging.some((ap) => ap.packagingMaterialId === p.id))
                            .map((p) => {
                              const stock = getStockStatus(p.id, "packaging", 0);
                              return (
                                <SelectItem key={p.id} value={p.id}>
                                  <div className="flex items-center justify-between w-full gap-4">
                                    <span>{p.name}</span>
                                    <span className={cn("text-[10px] tabular-nums", stock.current <= (p.minimumStockLevel || 0) ? "text-destructive font-bold" : "text-muted-foreground")}>
                                      {stock.current} in stock
                                    </span>
                                  </div>
                                </SelectItem>
                              );
                            })}
                        </SelectContent>
                      </Select>

                      {/* Per-unit / per-carton toggle */}
                      <div className="flex items-center bg-muted rounded-md p-0.5 shrink-0">
                        {(["per_unit", "per_carton"] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setTempPkgUnit(u)}
                            className={cn(
                              "px-2 py-1 rounded text-[10px] font-semibold transition-all",
                              tempPkgUnit === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {u === "per_unit" ? "/unit" : "/carton"}
                          </button>
                        ))}
                      </div>

                      <Input
                        type="number"
                        step="any"
                        placeholder="Qty"
                        className="w-20 h-9 font-mono font-bold bg-background text-primary text-sm"
                        value={tempPkgQty}
                        onChange={(e) => setTempPkgQty(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddAdditionalPackaging()}
                      />
                      <Button onClick={handleAddAdditionalPackaging} size="sm" className="h-9 w-9 p-0 shrink-0" disabled={!tempPackagingId || !tempPkgQty}>
                        <Plus className="size-4" />
                      </Button>
                    </div>

                    {/* List */}
                    <div className="space-y-2">
                      {values.additionalPackaging.map((pkg, idx) => {
                        const material = materials.packagings.find((m) => m.id === pkg.packagingMaterialId);
                        const totalNeeded = getPlannedPackagingQuantity({
                          quantityPerContainer: pkg.quantityPerContainer,
                          usageBasis: pkg.usageBasis,
                          targetUnits: values.producedUnits || 0,
                          containersPerCarton: values.containersPerCarton,
                        });
                        const stock = getStockStatus(pkg.packagingMaterialId, "packaging", totalNeeded);
                        return (
                          <div key={idx} className="flex items-start gap-3 p-3.5 rounded-xl border border-border/50 bg-background hover:border-primary/30 hover:bg-primary/2 transition-all">
                            <div className="flex-1 space-y-2 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm truncate">{material?.name}</span>
                                <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                                  PKR {material?.costPerUnit}/u · {pkg.usageBasis === "per_carton" ? "/carton" : "/unit"}
                                </span>
                              </div>
                              <StockIndicator current={stock.current} needed={totalNeeded} />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="space-y-0.5">
                                <Input
                                  type="number"
                                  step="any"
                                  className="w-24 h-9 text-right text-sm font-mono font-bold text-primary"
                                  value={totalNeeded || ""}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    const divisor = pkg.usageBasis === "per_carton"
                                      ? Math.max(cartonsCount, 1)
                                      : Math.max(values.producedUnits || 0, 1);
                                    const perUnit = val / divisor;
                                    const newPkg = [...values.additionalPackaging];
                                    newPkg[idx] = { ...newPkg[idx], quantityPerContainer: perUnit };
                                    form.setFieldValue("additionalPackaging", newPkg);
                                  }}
                                />
                                <p className="text-[10px] text-muted-foreground text-right">total</p>
                              </div>
                              <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleRemoveAdditionalPackaging(idx)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                RIGHT — LIVE ANALYSIS
            ══════════════════════════════════════════════════════════════════ */}
            <div className="space-y-4">
              <div className="sticky top-16 space-y-4">

                {/* ── Cost summary card ─────────────────────────────────── */}
                <Card className="border-primary/20 shadow-sm">
                  <CardHeader className="px-5 py-4 border-b border-border/40">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-primary/10 rounded-lg">
                          <Calculator className="size-4 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-semibold">Live Analysis</CardTitle>
                          <CardDescription className="text-[11px]">Real-time cost estimation</CardDescription>
                        </div>
                      </div>
                      <Badge variant="outline" className="font-mono text-xs bg-background">PKR</Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-5 space-y-5">
                    {/* Primary metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
                        <p className="text-[10px] font-semibold uppercase text-primary/60 mb-1">Total Batch</p>
                        <p className="text-2xl font-black tracking-tight text-primary font-mono">
                          {totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">estimated</p>
                      </div>
                      <div className="p-4 rounded-xl bg-muted/40 border border-border/50">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Per Unit</p>
                        <p className="text-2xl font-black tracking-tight font-mono">
                          {costPerUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">{values.producedUnits} units</p>
                      </div>
                    </div>

                    <Separator />

                    {/* Cost breakdown with bars */}
                    <div className="space-y-3.5">
                      <p className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">Cost Distribution</p>

                      {[
                        { label: "Ingredients", value: ingredientsCost, color: "bg-emerald-500", dot: "bg-emerald-500" },
                        { label: `Primary packaging${selectedContainer ? ` · ${selectedContainer.name}` : ""}`, value: containersCost, color: "bg-blue-500", dot: "bg-blue-500" },
                        { label: `Master cartons · ${cartonsCalculation.boxesNeeded}`, value: cartonsCalculation.cost, color: "bg-amber-500", dot: "bg-amber-500" },
                        { label: "Additional materials", value: additionalPackagingCost, color: "bg-purple-500", dot: "bg-purple-500" },
                      ].map(({ label, value, color, dot }) => (
                        <div key={label} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={cn("size-2 rounded-full shrink-0", dot)} />
                              <span className="text-muted-foreground truncate">{label}</span>
                            </div>
                            <span className="font-mono font-semibold tabular-nums shrink-0 ml-2">
                              {value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <CostBar value={value} total={totalCost} color={color} />
                        </div>
                      ))}
                    </div>

                    {/* Inline alerts */}
                    {values.ingredients.length === 0 && (
                      <div className="flex gap-2.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                        <p className="text-xs leading-relaxed">Add ingredients to calculate formulation costs.</p>
                      </div>
                    )}
                    {!selectedContainer && (
                      <div className="flex gap-2.5 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400">
                        <Info className="size-3.5 shrink-0 mt-0.5" />
                        <p className="text-xs leading-relaxed">Select a primary container to include packaging costs.</p>
                      </div>
                    )}
                  </CardContent>

                  <CardFooter className="px-5 py-3 border-t bg-muted/10">
                    <div className="flex items-center justify-between w-full text-[11px] text-muted-foreground">
                      <span>Costs based on moving average</span>
                      <RefreshCw className="size-3" />
                    </div>
                  </CardFooter>
                </Card>

                {/* ── Production note ─────────────────────────────────────── */}
                <div className="rounded-xl bg-muted/30 border border-border/40 p-4">
                  <div className="flex items-start gap-2.5">
                    <Info className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Verify warehouse stock before initiating a production run. All costs are estimates based on standard moving average pricing.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
