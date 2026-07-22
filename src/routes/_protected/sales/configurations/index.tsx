import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState, useMemo, useEffect } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateDiscountRule,
  useDeleteDiscountRule,
} from "@/hooks/sales/use-discount-rules";
import {
  getDiscountRulesFn,
} from "@/server-functions/sales/discount-rules-fn";
import {
  getCustomersByTypeFn,
  getRecipesFn,
} from "@/server-functions/sales/sales-config-fn";
import {
  useGetCommissionTiers,
  useCreateCommissionTier,
  useDeleteCommissionTier,
} from "@/hooks/sales/use-order-booker-commission";
import { useGetOrderBookers } from "@/hooks/sales/use-sales-people";
import {
  useGetEntityRecipeRatesForEntity,
  useUpsertEntityRecipeRate,
  useDeleteEntityRecipeRate,
} from "@/hooks/sales/use-entity-recipe-rates";
import { getOrderBookersFn } from "@/server-functions/sales/sales-config-fn";
import {
  getActiveTadaRateFn,
  listTadaRatesFn,
  setTadaRateFn,
  updateTadaRateFn,
} from "@/server-functions/hr/rates/tada-rates-fn";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trash2, Plus, Settings, Car, Pencil, Search, ChevronDown, Package, Check } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/custom/date-picker";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  GENERAL_RECIPE_RATE_ENTITY_ID,
  type EntityRecipeRateEntityType,
} from "@/lib/sales/entity-recipe-rate-config";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

export const Route = createFileRoute("/_protected/sales/configurations/")({
  loader: async ({ context }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["active-tada-rate"],
      queryFn: () => getActiveTadaRateFn(),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["tada-rate-history"],
      queryFn: () => listTadaRatesFn(),
    });
  },
  component: SalesConfigurationsPage,
});

function SalesConfigurationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Sales Configurations</h2>
        <p className="text-muted-foreground mt-1">
          Manage discount rules, TADA rates, and commission tiers.
        </p>
      </div>
      <Separator />
      <Suspense fallback={<GenericLoader title="Loading Configurations" description="Fetching settings..." />}>
        <ConfigurationsContent />
      </Suspense>
    </div>
  );
}

function ConfigurationsContent() {
  return (
    <Tabs defaultValue="discount" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="discount">Discount</TabsTrigger>
        <TabsTrigger value="tada">TADA Rate</TabsTrigger>
        <TabsTrigger value="commissions">Commission Tiers</TabsTrigger>
        <TabsTrigger value="rates">Recipe Rates</TabsTrigger>
      </TabsList>

      <TabsContent value="discount">
        <DiscountTab />
      </TabsContent>

      <TabsContent value="tada">
        <TadaRateTab />
      </TabsContent>

      <TabsContent value="commissions">
        <CommissionTiersTab />
      </TabsContent>

      <TabsContent value="rates">
        <RecipeRatesTab />
      </TabsContent>
    </Tabs>
  );
}

// ── Discount Tab ──
function DiscountTab() {
  const { data: rules } = useQuery({
    queryKey: ["discount-rules"],
    queryFn: () => getDiscountRulesFn({ data: {} }),
  });
  const deleteMutation = useDeleteDiscountRule();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Discount Rules</h3>
        <AddDiscountRuleDialog />
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Distributor</TableHead>
              <TableHead className="text-[11px]">Item / Recipe</TableHead>
              <TableHead className="text-[11px] text-right">Buy Qty</TableHead>
              <TableHead className="text-[11px] text-right">Free Units</TableHead>
              <TableHead className="text-[11px]">Effective</TableHead>
              <TableHead className="text-[11px] w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rules?.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">
                  No discount rules configured.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium">{r.customer?.name}</TableCell>
                  <TableCell className="text-sm">{r.recipe?.name}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.quantityThreshold}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.freeUnits}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(r.effectiveFrom), "dd MMM yyyy")}
                    {r.effectiveTo && ` → ${format(new Date(r.effectiveTo), "dd MMM yyyy")}`}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => deleteMutation.mutate({ data: { id: r.id } })}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddDiscountRuleDialog() {
  const [open, setOpen] = useState(false);
  const createMutation = useCreateDiscountRule();
  const [form, setForm] = useState({
    customerId: "",
    recipeId: "",
    quantityThreshold: "",
    freeUnits: "",
  });

  const { data: distributors } = useQuery({
    queryKey: ["distributors-for-discount"],
    queryFn: () => getCustomersByTypeFn({ data: { customerType: "distributor", page: 1, limit: 200 } }),
  });

  const { data: recipesList } = useQuery({
    queryKey: ["all-recipes"],
    queryFn: () => getRecipesFn(),
  });

  const handleSubmit = () => {
    if (!form.customerId || !form.recipeId || !form.quantityThreshold || !form.freeUnits) {
      toast.error("All fields are required");
      return;
    }
    createMutation.mutate(
      {
        data: {
          customerId: form.customerId,
          recipeId: form.recipeId,
          ruleType: "free_units",
          quantityThreshold: Number(form.quantityThreshold),
          freeUnits: Number(form.freeUnits),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success("Discount rule created");
          setForm({ customerId: "", recipeId: "", quantityThreshold: "", freeUnits: "" });
        },
        onError: (error) => {
          toast.error(error.message || "Failed to create discount rule");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4 mr-1.5" />
          Add Rule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Discount Rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Distributor</Label>
            <Select value={form.customerId} onValueChange={(v) => setForm((f) => ({ ...f, customerId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select distributor" />
              </SelectTrigger>
              <SelectContent>
                {distributors?.data?.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Item / Recipe</Label>
            <Select value={form.recipeId} onValueChange={(v) => setForm((f) => ({ ...f, recipeId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select item" />
              </SelectTrigger>
              <SelectContent>
                {recipesList?.map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Buy Qty (cartons)</Label>
              <Input type="number" value={form.quantityThreshold} onChange={(e) => setForm((f) => ({ ...f, quantityThreshold: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Free Units</Label>
              <Input type="number" value={form.freeUnits} onChange={(e) => setForm((f) => ({ ...f, freeUnits: e.target.value }))} />
            </div>
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={createMutation.isPending}>
            Create Rule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── TADA Rate Tab ──
function TadaRateTab() {
  const { data: activeRate } = useQuery({
    queryKey: ["active-tada-rate"],
    queryFn: () => getActiveTadaRateFn(),
  });

  const { data: history } = useQuery({
    queryKey: ["tada-rate-history"],
    queryFn: () => listTadaRatesFn(),
  });

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ratePerKm, setRatePerKm] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState<Date>(new Date());
  const [editRatePerKm, setEditRatePerKm] = useState("");
  const [editEffectiveFrom, setEditEffectiveFrom] = useState<Date>(new Date());
  const [editRemarks, setEditRemarks] = useState("");
  const qc = useQueryClient();

  const setRateMutation = useMutation({
    mutationFn: setTadaRateFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-tada-rate"] });
      qc.invalidateQueries({ queryKey: ["tada-rate-history"] });
      setOpen(false);
      setRatePerKm("");
      setEffectiveFrom(new Date());
      toast.success("TADA rate created");
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: updateTadaRateFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-tada-rate"] });
      qc.invalidateQueries({ queryKey: ["tada-rate-history"] });
      setEditOpen(false);
      toast.success("TADA rate updated");
    },
  });

  const handleEditOpen = () => {
    if (activeRate) {
      setEditRatePerKm(activeRate.ratePerKm.toString());
      setEditEffectiveFrom(new Date(activeRate.effectiveFrom));
      setEditRemarks(activeRate.remarks || "");
      setEditOpen(true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">TA/DA Rate Configuration</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Settings className="size-4 mr-1.5" />
              Set Rate
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Set New TA/DA Rate</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Rate per KM (PKR)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={ratePerKm}
                  onChange={(e) => setRatePerKm(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <DatePicker
                  date={effectiveFrom}
                  onChange={(d) => d && setEffectiveFrom(d)}
                  className="w-full"
                />
              </div>
              <Button
                className="w-full"
                onClick={() =>
                  setRateMutation.mutate({
                    data: {
                      ratePerKm: Number(ratePerKm),
                      effectiveFrom: format(effectiveFrom, "yyyy-MM-dd"),
                    },
                  })
                }
                disabled={setRateMutation.isPending || !ratePerKm}
              >
                Save Rate
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Car className="size-3.5 text-emerald-600" />
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Current Active Rate</p>
            </div>
            {activeRate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={handleEditOpen}
              >
                <Pencil className="size-3 mr-1" />
                Edit
              </Button>
            )}
          </div>
          <p className="text-2xl font-bold tabular-nums text-emerald-700">
            {activeRate ? PKR(Number(activeRate.ratePerKm)) : "Not Set"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Effective from {activeRate ? format(new Date(activeRate.effectiveFrom), "dd MMM yyyy") : "—"}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Rate</TableHead>
              <TableHead className="text-[11px]">Effective From</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]">Set By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!history?.length ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-10 text-sm">
                  No rate history.
                </TableCell>
              </TableRow>
            ) : (
              history.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium tabular-nums">{PKR(Number(r.ratePerKm))}</TableCell>
                  <TableCell className="text-sm">{format(new Date(r.effectiveFrom), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? "default" : "outline"} className="text-[10px]">
                      {r.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.setter?.name || "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit TA/DA Rate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Rate per KM (PKR)</Label>
              <Input
                type="number"
                step="0.01"
                value={editRatePerKm}
                onChange={(e) => setEditRatePerKm(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Effective From</Label>
              <DatePicker
                date={editEffectiveFrom}
                onChange={(d) => d && setEditEffectiveFrom(d)}
                className="w-full"
              />
            </div>
            <Button
              className="w-full"
              onClick={() =>
                updateRateMutation.mutate({
                  data: {
                    id: activeRate?.id || "",
                    ratePerKm: Number(editRatePerKm),
                    effectiveFrom: format(editEffectiveFrom, "yyyy-MM-dd"),
                    remarks: editRemarks || undefined,
                  },
                })
              }
              disabled={updateRateMutation.isPending || !editRatePerKm}
            >
              Update Rate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Commission Tiers Tab ──
function CommissionTiersTab() {
  const { data: tiers } = useGetCommissionTiers();
  const { data: orderBookers } = useGetOrderBookers();
  const createTier = useCreateCommissionTier();
  const deleteTier = useDeleteCommissionTier();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ orderBookerId: "", minAmount: "", maxAmount: "", rate: "" });

  const handleSubmit = () => {
    createTier.mutate(
      {
        data: {
          orderBookerId: form.orderBookerId || undefined,
          minAmount: Number(form.minAmount) || 0,
          maxAmount: form.maxAmount ? Number(form.maxAmount) : null,
          rate: Number(form.rate) || 0,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success("Commission tier created");
          setForm({ orderBookerId: "", minAmount: "", maxAmount: "", rate: "" });
        },
      },
    );
  };

  const bookerMap = new Map(orderBookers?.map((ob: any) => [ob.id, ob.name]) ?? []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Commission Tiers</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="size-4 mr-1.5" />Add Tier</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>New Commission Tier</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Order Booker (optional — leave empty for global tier)</Label>
                <Select value={form.orderBookerId} onValueChange={(v) => setForm((f) => ({ ...f, orderBookerId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Global tier (applies to all)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(orderBookers || []).map((ob: any) => (
                      <SelectItem key={ob.id} value={ob.id}>{ob.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Min Amount (PKR)</Label>
                  <Input type="number" value={form.minAmount} onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Max Amount (PKR)</Label>
                  <Input type="number" value={form.maxAmount} onChange={(e) => setForm((f) => ({ ...f, maxAmount: e.target.value }))} placeholder="Unlimited" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Rate (%)</Label>
                <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
              </div>
              <Button className="w-full" onClick={handleSubmit} disabled={createTier.isPending}>
                Create {form.orderBookerId ? "Custom" : "Global"} Tier
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Order Booker</TableHead>
              <TableHead className="text-[11px]">Min Amount</TableHead>
              <TableHead className="text-[11px]">Max Amount</TableHead>
              <TableHead className="text-[11px] text-right">Rate</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px] w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!tiers?.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">No commission tiers found.</TableCell>
              </TableRow>
            ) : (
              tiers.map((tier: any) => (
                <TableRow key={tier.id}>
                  <TableCell className="text-sm">
                    {tier.orderBookerId ? (
                      <Badge variant="secondary" className="text-[10px]">{bookerMap.get(tier.orderBookerId) || "Custom"}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Global</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">PKR {tier.minAmount}</TableCell>
                  <TableCell className="text-sm">{tier.maxAmount ? `PKR ${tier.maxAmount}` : "Unlimited"}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{tier.rate}%</TableCell>
                  <TableCell>
                    <Badge variant={tier.isActive ? "default" : "outline"} className="text-[10px]">{tier.isActive ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] text-rose-500" onClick={() => deleteTier.mutate({ data: { id: tier.id } })}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Recipe Rates Tab ──────────────────────────────────────────────────────────
// Per-entity (distributor or order booker) carton-rate configuration per recipe.
// Recipes are grouped by product with collapsible sections and a search filter
// to handle the "lots of recipes per product" case.
function RecipeRatesTab() {
  const [entityType, setEntityType] = useState<EntityRecipeRateEntityType>("order_booker");
  const [entityId, setEntityId] = useState("");
  const [search, setSearch] = useState("");
  const resolvedEntityId =
    entityType === "general" ? GENERAL_RECIPE_RATE_ENTITY_ID : entityId;

  // Fetch distributors or order bookers based on entity type
  const { data: distributors } = useQuery({
    queryKey: ["distributors-for-rates"],
    queryFn: () => getCustomersByTypeFn({ data: { customerType: "distributor", page: 1, limit: 500 } }),
    enabled: entityType === "distributor",
  });
  const { data: orderBookers } = useQuery({
    queryKey: ["order-bookers-for-rates"],
    queryFn: () => getOrderBookersFn({ data: { status: "active" } }),
    enabled: entityType === "order_booker",
  });

  // Fetch all recipes (grouped by product in the UI)
  const { data: recipesList } = useQuery({
    queryKey: ["all-recipes"],
    queryFn: () => getRecipesFn(),
  });

  // Fetch configured rates for the selected entity
  const { data: configuredRates } = useGetEntityRecipeRatesForEntity(
    entityType,
    resolvedEntityId,
    !!resolvedEntityId,
  );

  // Build a map: recipeId → { rateId, pricePerCarton } for quick lookup
  const rateMap = useMemo(() => {
    const map = new Map<string, { id: string; pricePerCarton: number }>();
    if (!configuredRates) return map;
    for (const r of configuredRates as any[]) {
      map.set(r.recipeId, { id: r.id, pricePerCarton: Number(r.pricePerCarton) });
    }
    return map;
  }, [configuredRates]);

  // Group recipes by product and filter by search
  const groupedRecipes = useMemo(() => {
    if (!recipesList) return [];
    const term = search.trim().toLowerCase();
    const groups = new Map<string, { productId: string; productName: string; recipes: any[] }>();
    for (const r of recipesList as any[]) {
      const recipeName = r.name?.toLowerCase() ?? "";
      const pName = r.product?.name?.toLowerCase() ?? "";
      if (term && !recipeName.includes(term) && !pName.includes(term)) continue;
      const productId = r.product?.id ?? "unknown";
      const pLabel = r.product?.name ?? "Unknown Product";
      if (!groups.has(productId)) {
        groups.set(productId, { productId, productName: pLabel, recipes: [] });
      }
      groups.get(productId)!.recipes.push(r);
    }
    return Array.from(groups.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [recipesList, search]);

  const entityOptions =
    entityType === "distributor"
      ? (distributors?.data ?? []).map((d: any) => ({ id: d.id, name: d.name }))
      : entityType === "order_booker"
      ? (orderBookers ?? []).map((ob: any) => ({ id: ob.id, name: ob.name }))
      : [];

  const configuredCount = rateMap.size;
  const totalRecipes = (recipesList ?? []).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Recipe Rates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure carton prices per recipe for distributors, order bookers, or general walk-in invoices.
            Per-pack price is derived from the carton rate and recipe's containers-per-carton.
          </p>
        </div>
      </div>

      {/* Entity type + entity selector + search */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entity Type</Label>
          <Select
            value={entityType}
            onValueChange={(v) => { setEntityType(v as any); setEntityId(""); }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="order_booker">Order Booker</SelectItem>
              <SelectItem value="distributor">Distributor</SelectItem>
              <SelectItem value="general">General / Walk-in</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {entityType === "general" ? (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile</Label>
            <div className="flex h-10 items-center rounded-md border bg-muted/20 px-3 text-sm">
              General / Walk-in base rates
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {entityType === "distributor" ? "Distributor" : "Order Booker"}
            </Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${entityType === "distributor" ? "distributor" : "order booker"}`} />
              </SelectTrigger>
              <SelectContent>
                {entityOptions.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Search Recipes</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Recipe or product name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {!resolvedEntityId ? (
        <div className="text-center text-muted-foreground py-16 border border-dashed rounded-xl">
          <Package className="size-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm">Select a {entityType === "distributor" ? "distributor" : "order booker"} to configure rates.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px]">{configuredCount} configured</Badge>
            <Badge variant="outline" className="text-[10px]">{totalRecipes} total recipes</Badge>
          </div>

          <div className="space-y-2">
            {groupedRecipes.length === 0 ? (
              <div className="text-center text-muted-foreground py-10 text-sm border border-dashed rounded-xl">
                No recipes match "{search}".
              </div>
            ) : (
              groupedRecipes.map((group) => (
                <RecipeProductGroup
                  key={group.productId}
                  productName={group.productName}
                  recipes={group.recipes}
                  rateMap={rateMap}
                  entityType={entityType}
                  entityId={resolvedEntityId}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RecipeProductGroup({
  productName,
  recipes,
  rateMap,
  entityType,
  entityId,
}: {
  productName: string;
  recipes: any[];
  rateMap: Map<string, { id: string; pricePerCarton: number }>;
  entityType: EntityRecipeRateEntityType;
  entityId: string;
}) {
  const configuredInGroup = recipes.filter((r) => rateMap.has(r.id)).length;

  return (
    <Collapsible defaultOpen={configuredInGroup > 0}>
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{productName}</span>
              <Badge variant="outline" className="text-[10px]">{recipes.length} recipes</Badge>
              {configuredInGroup > 0 && (
                <Badge variant="secondary" className="text-[10px]">{configuredInGroup} priced</Badge>
              )}
            </div>
            <ChevronDown className="size-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y border-t">
            {recipes.map((r) => (
              <RecipeRateRow
                key={r.id}
                recipe={r}
                configured={rateMap.get(r.id)}
                entityType={entityType}
                entityId={entityId}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function RecipeRateRow({
  recipe,
  configured,
  entityType,
  entityId,
}: {
  recipe: any;
  configured?: { id: string; pricePerCarton: number };
  entityType: EntityRecipeRateEntityType;
  entityId: string;
}) {
  const upsert = useUpsertEntityRecipeRate();
  const remove = useDeleteEntityRecipeRate();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const containersPerCarton = Number(recipe.containersPerCarton ?? 0);
  const perPackDerived =
    containersPerCarton > 0 && configured
      ? configured.pricePerCarton / containersPerCarton
      : null;

  useEffect(() => {
    if (configured) setValue(String(configured.pricePerCarton));
  }, [configured?.pricePerCarton]);

  const handleSave = () => {
    const numVal = Number(value);
    if (isNaN(numVal) || numVal < 0) {
      toast.error("Price must be a non-negative number");
      return;
    }
    upsert.mutate(
      {
        data: {
          entityType,
          entityId,
          recipeId: recipe.id,
          pricePerCarton: numVal,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success("Rate saved");
        },
        onError: (e: any) => toast.error(e.message || "Failed to save rate"),
      },
    );
  };

  const handleDelete = () => {
    if (!configured) return;
    remove.mutate(
      { data: { id: configured.id } },
      {
        onSuccess: () => {
          setEditing(false);
          setValue("");
          toast.success("Rate removed");
        },
      },
    );
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{recipe.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {containersPerCarton > 0
            ? `${containersPerCarton} packs/carton`
            : "No carton packaging"}
          {perPackDerived !== null && (
            <span className="ml-2">· ~PKR {perPackDerived.toFixed(2)}/pack</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-semibold pointer-events-none">₨</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="h-8 w-28 text-xs pl-5"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
              />
            </div>
            <Button size="sm" variant="default" className="h-8 px-2" onClick={handleSave} disabled={upsert.isPending}>
              <Check className="size-3.5" />
            </Button>
            {configured && (
              <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:bg-destructive/10" onClick={handleDelete} disabled={remove.isPending}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </>
        ) : configured ? (
          <>
            <span className="text-sm font-mono tabular-nums font-semibold">{PKR(configured.pricePerCarton)}</span>
            <span className="text-[10px] text-muted-foreground">/carton</span>
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground italic">Not configured</span>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setValue(""); setEditing(true); }}>
              <Plus className="size-3 mr-1" />Set Rate
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
