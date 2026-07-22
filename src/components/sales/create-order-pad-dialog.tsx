import { useState, useMemo, useCallback, useEffect } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import type { AnyFieldApi } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  ShoppingCart,
  Store,
  User,
  Calculator,
  RotateCcw,
  AlertTriangle,
  TrendingUp,
  Navigation,
} from "lucide-react";
import { formatPKR } from "@/lib/currency-format";
import { getProductsFn } from "@/server-functions/sales/sales-config-fn";
import { getRecipesByProductFn } from "@/server-functions/inventory/recipes/get-recipes-by-product-fn";
import { getOrderBookerCommissionTiersFn } from "@/server-functions/sales/order-booker-commission-fn";
import { getRecipeRatesForEntityFn } from "@/server-functions/sales/entity-recipe-rates-fn";
import { useCreateOrder } from "@/hooks/sales/use-orders";
import {
  ORDER_BOOKER_SHOP_TYPE_OPTIONS,
  ORDER_BOOKER_VEHICLE_TYPE_OPTIONS,
  type OrderBookerTripFormValues,
  getOrderBookerTripFormError,
  parseOrderBookerTripForm,
} from "@/lib/sales/order-booker-trip-form";
import { getOrderBookerTripEligibilityFn } from "@/server-functions/sales/get-order-booker-trip-eligibility-fn";

/* ────────────────────────────────────────────────────────────────────────────
   TYPES
   ──────────────────────────────────────────────────────────────────────────── */

interface OrderBooker {
  id: string;
  name: string;
  commissionRate?: string | null;
}

interface Recipe {
  id: string;
  name: string;
  containersPerCarton: number | null;
  estimatedCostPerContainer: string | null;
}

interface CommissionTier {
  id: string;
  minAmount: string;
  maxAmount: string | null;
  rate: string;
}

interface EntityRecipeRate {
  recipeId: string;
  pricePerCarton: number;
  containersPerCarton: number;
}

interface OrderItemForm {
  productId: string;
  recipeId: string;
  unitType: string;
  quantity: number;
  rate: number;
}

type TripForm = OrderBookerTripFormValues;

/* ────────────────────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────────────────────── */

function blankItem(): OrderItemForm {
  return { productId: "", recipeId: "", unitType: "carton", quantity: 1, rate: 0 };
}

function blankTrip(): TripForm {
  return {
    tripDate: format(new Date(), "yyyy-MM-dd"),
    destination: "",
    shopType: "old",
    distanceKm: 0,
    vehicleType: "own_vehicle",
    fuelCost: 0,
    notes: "",
  };
}

function formatRate(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

function getDefaultOrderUnitType(containersPerCarton: number | null | undefined): string {
  return Number(containersPerCarton ?? 0) > 0 ? "carton" : "pack";
}

function getAllowedOrderUnitTypes(containersPerCarton: number | null | undefined) {
  return Number(containersPerCarton ?? 0) > 0
    ? [
        { value: "carton", label: "Carton" },
        { value: "half carton", label: "Half Carton" },
      ]
    : [{ value: "pack", label: "Pack" }];
}

/* ────────────────────────────────────────────────────────────────────────────
   COMMISSION TIER UTILS
   ──────────────────────────────────────────────────────────────────────────── */

function findApplicableTier(totalSale: number, tiers: CommissionTier[]): CommissionTier | null {
  for (const tier of tiers) {
    const min = Number(tier.minAmount);
    const max = tier.maxAmount ? Number(tier.maxAmount) : Infinity;
    if (totalSale >= min && totalSale <= max) {
      return tier;
    }
  }
  return null;
}

function computeObMarginRate(totalSale: number, tiers: CommissionTier[], flatRate: number): number {
  const tier = findApplicableTier(totalSale, tiers);
  if (tier) return Number(tier.rate);
  return flatRate;
}

/* ────────────────────────────────────────────────────────────────────────────
   SUB-COMPONENTS
   ──────────────────────────────────────────────────────────────────────────── */

function CommissionThresholdsPanel({
  tiers,
  flatRate,
  totalSale,
}: {
  tiers: CommissionTier[];
  flatRate: number;
  totalSale: number;
}) {
  if (tiers.length === 0 && flatRate === 0) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <AlertTriangle className="size-3" />
        No commission thresholds configured.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="size-3" />
        Commission Thresholds
      </div>
      <div className="space-y-1">
        {tiers.map((tier) => {
          const min = Number(tier.minAmount);
          const max = tier.maxAmount ? Number(tier.maxAmount) : Infinity;
          const isActive = totalSale >= min && totalSale <= max;
          return (
            <div
              key={tier.id}
              className={`flex items-center justify-between text-xs px-2 py-1 rounded ${
                isActive ? "bg-emerald-500/10 border border-emerald-500/30" : ""
              }`}
            >
              <span className="font-mono text-muted-foreground">
                {formatPKR(min)} — {tier.maxAmount ? formatPKR(Number(tier.maxAmount)) : "∞"}
              </span>
              <span className={`font-bold font-mono ${isActive ? "text-emerald-400" : ""}`}>
                {formatRate(Number(tier.rate))}
                {isActive && <span className="ml-1 text-[10px]">← current</span>}
              </span>
            </div>
          );
        })}
        {tiers.length === 0 && flatRate > 0 && (
          <div className="text-xs text-muted-foreground">
            Flat rate: {formatRate(flatRate)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
   ──────────────────────────────────────────────────────────────────────────── */

interface CreateOrderPadDialogProps {
  orderBookers: OrderBooker[];
}

export function CreateOrderPadDialog({ orderBookers }: CreateOrderPadDialogProps) {
  const [open, setOpen] = useState(false);
  const [manualRateOverrides, setManualRateOverrides] = useState<Set<number>>(new Set());
  const create = useCreateOrder();

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProductsFn(),
  });

  const form = useForm({
    defaultValues: {
      orderBookerId: "",
      shopkeeperName: "",
      shopkeeperMobile: "",
      shopkeeperAddress: "",
      notes: "",
      trip: blankTrip(),
      items: [blankItem()],
    },
    onSubmit: async ({ value }) => {
      if (!value.orderBookerId || !value.shopkeeperName) {
        toast.error("Order booker and shopkeeper name are required");
        return;
      }
      if (value.items.some((i) => !i.productId || !i.recipeId || i.quantity <= 0 || !i.unitType.trim())) {
        toast.error("All items must have a product, recipe, unit type, and positive quantity");
        return;
      }
      if (blockedReason) {
        toast.error(blockedReason);
        return;
      }

      let tripValues;
      try {
        tripValues = parseOrderBookerTripForm(value.trip);
      } catch (error) {
        toast.error(getOrderBookerTripFormError(error));
        return;
      }

      create.mutate(
        {
          data: {
            orderBookerId: value.orderBookerId,
            shopkeeperName: value.shopkeeperName,
            shopkeeperMobile: value.shopkeeperMobile || undefined,
            shopkeeperAddress: value.shopkeeperAddress || undefined,
            trip: {
              tripDate: tripValues.tripDate,
              destination: tripValues.destination,
              shopType: tripValues.shopType,
              distanceKm: tripValues.distanceKm,
              vehicleType: tripValues.vehicleType,
              fuelCost: tripValues.fuelCost,
              notes: tripValues.notes,
            },
            items: value.items.map((i) => ({
              productId: i.productId,
              recipeId: i.recipeId,
              unitType: i.unitType.trim(),
              quantity: i.quantity,
              rate: i.rate,
            })),
            notes: value.notes || undefined,
          },
        },
        {
          onSuccess: () => {
            setOpen(false);
            toast.success("Order and trip created");
            form.reset();
            setManualRateOverrides(new Set());
          },
        },
      );
    },
  });

  const items = useStore(form.store, (state) => state.values.items);
  const orderBookerId = useStore(form.store, (state) => state.values.orderBookerId);
  const tripDate = useStore(form.store, (state) => state.values.trip.tripDate);
  const vehicleType = useStore(form.store, (state) => state.values.trip.vehicleType);

  const { data: tripEligibility, isFetching: isCheckingTripEligibility } = useQuery({
    queryKey: ["orderBookerTripEligibility", orderBookerId, tripDate],
    queryFn: () =>
      getOrderBookerTripEligibilityFn({
        data: {
          orderBookerId,
          tripDate,
        },
      }),
    enabled: open && !!orderBookerId && !!tripDate,
  });

  const blockedReason =
    tripEligibility && !tripEligibility.isAllowed
      ? tripEligibility.reasonMessage ?? "Trips are blocked for this date."
      : null;

  const selectedBooker = orderBookers.find((ob) => ob.id === orderBookerId);
  const flatCommissionRate = selectedBooker?.commissionRate
    ? Number(selectedBooker.commissionRate)
    : 0;

  // Fetch commission tiers for selected order booker
  const { data: commissionTiers } = useQuery({
    queryKey: ["commissionTiers", orderBookerId],
    queryFn: () => getOrderBookerCommissionTiersFn({ data: { orderBookerId } }),
    enabled: !!orderBookerId,
  });

  // Fetch configured recipe rates for the selected order booker.
  // This is the primary rate source — when a recipe is selected, its
  // configured carton price is auto-populated into the rate field.
  const { data: obRecipeRates } = useQuery({
    queryKey: ["entity-recipe-rates", "rates", "order_booker", orderBookerId],
    queryFn: () => getRecipeRatesForEntityFn({ data: { entityType: "order_booker", entityId: orderBookerId } }),
    enabled: !!orderBookerId,
  });

  // Map: recipeId → configured carton price
  const obRateMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!obRecipeRates) return map;
    for (const r of obRecipeRates as EntityRecipeRate[]) {
      map.set(r.recipeId, r.pricePerCarton);
    }
    return map;
  }, [obRecipeRates]);

  // Global order totals — rate is now the configured price (no admin margin, no factory cost derivation).
  const { totalSale, obMarginRate, obMarginAmount } = useMemo(() => {
    const sale = items.reduce((sum, item) => sum + item.rate * item.quantity, 0);
    const obRate = computeObMarginRate(sale, commissionTiers ?? [], flatCommissionRate);
    const obAmount = sale * (obRate / 100);
    return {
      totalSale: sale,
      obMarginRate: obRate,
      obMarginAmount: obAmount,
    };
  }, [items, commissionTiers, flatCommissionRate]);

  // Auto-populate rate from configured OB carton price when a recipe is selected
  // (unless the user has manually overridden the rate for that line).
  useEffect(() => {
    items.forEach((item, idx) => {
      if (manualRateOverrides.has(idx)) return;
      if (!item.recipeId) return;

      const configuredRate = obRateMap.get(item.recipeId);
      if (configuredRate !== undefined && configuredRate > 0) {
        const rounded = Math.round(configuredRate * 100) / 100;
        if (rounded !== item.rate) {
          form.setFieldValue(`items[${idx}].rate`, rounded);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, obRateMap]);

  const handleProductChange = useCallback(
    (index: number, productId: string) => {
      form.setFieldValue(`items[${index}].productId`, productId);
      form.setFieldValue(`items[${index}].recipeId`, "");
      form.setFieldValue(`items[${index}].rate`, 0);
      setManualRateOverrides((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    },
    [form],
  );

  const handleRecipeChange = useCallback(
    (
      index: number,
      recipeId: string,
      selectedRecipe?: Pick<Recipe, "containersPerCarton">,
    ) => {
      form.setFieldValue(`items[${index}].recipeId`, recipeId);
      form.setFieldValue(
        `items[${index}].unitType`,
        getDefaultOrderUnitType(selectedRecipe?.containersPerCarton),
      );
      // Clear manual override so auto-populate kicks in for the new recipe
      setManualRateOverrides((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      // Immediately set rate if we have a configured price
      const configuredRate = obRateMap.get(recipeId);
      if (configuredRate !== undefined && configuredRate > 0) {
        const rounded = Math.round(configuredRate * 100) / 100;
        form.setFieldValue(`items[${index}].rate`, rounded);
      } else {
        form.setFieldValue(`items[${index}].rate`, 0);
      }
    },
    [form, obRateMap],
  );

  const handleRateManualChange = useCallback(
    (index: number, value: number) => {
      form.setFieldValue(`items[${index}].rate`, value);
      setManualRateOverrides((prev) => new Set(prev).add(index));
    },
    [form],
  );

  const resetRate = useCallback(
    (index: number) => {
      setManualRateOverrides((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      // Re-populate from config immediately
      const recipeId = form.getFieldValue(`items[${index}].recipeId`);
      const configuredRate = obRateMap.get(recipeId);
      if (configuredRate !== undefined && configuredRate > 0) {
        form.setFieldValue(`items[${index}].rate`, Math.round(configuredRate * 100) / 100);
      }
    },
    [form, obRateMap],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4 mr-1.5" />
          New Order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShoppingCart className="size-5 text-primary" />
            Create Order
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-5 pt-2"
        >
          {/* ── Header: Order Booker + Shopkeeper ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form.Field
              name="orderBookerId"
              validators={{ onChange: z.string().min(1, "Select order booker") }}
            >
              {(field) => (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <User className="size-3" />
                    Order Booker
                  </Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v)}
                  >
                    <SelectTrigger className={field.state.meta.errors.length > 0 ? "border-destructive" : ""}>
                      <SelectValue placeholder="Select order booker" />
                    </SelectTrigger>
                    <SelectContent>
                      {orderBookers.map((ob) => (
                        <SelectItem key={ob.id} value={ob.id}>
                          {ob.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>

            <form.Field
              name="shopkeeperName"
              validators={{ onChange: z.string().min(1, "Shopkeeper name is required") }}
            >
              {(field) => (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Store className="size-3" />
                    Shopkeeper Name
                  </Label>
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Enter shopkeeper name"
                    className={field.state.meta.errors.length > 0 ? "border-destructive" : ""}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="shopkeeperMobile">
              {(field) => (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mobile</Label>
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="03XX-XXXXXXX"
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="shopkeeperAddress">
              {(field) => (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</Label>
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Shop address"
                  />
                </div>
              )}
            </form.Field>
          </div>

          {/* ── Trip Details ── */}
          <div className="border rounded-lg p-4 bg-muted/10 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Navigation className="size-3" />
              Trip Details
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field
                name="trip.tripDate"
                validators={{ onChange: z.string().min(1, "Trip date is required") }}
              >
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</Label>
                    <Input
                      type="date"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className={field.state.meta.errors.length > 0 ? "border-destructive" : ""}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="trip.vehicleType">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vehicle</Label>
                    <Select value={field.state.value} onValueChange={(v: "own_vehicle" | "company_vehicle") => field.handleChange(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_BOOKER_VEHICLE_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>

              <form.Field name="trip.shopType">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shop Type</Label>
                    <Select value={field.state.value} onValueChange={(v: "old" | "new") => field.handleChange(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_BOOKER_SHOP_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>

              <form.Field
                name="trip.destination"
                validators={{ onChange: z.string().min(1, "Destination is required") }}
              >
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destination</Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Area or shop visited"
                      className={field.state.meta.errors.length > 0 ? "border-destructive" : ""}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field
                name="trip.distanceKm"
                validators={{ onChange: z.number().min(0, "Distance must be 0 or more") }}
              >
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Distance (km)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      className={field.state.meta.errors.length > 0 ? "border-destructive" : ""}
                    />
                  </div>
                )}
              </form.Field>

              {vehicleType === "own_vehicle" && (
                <form.Field name="trip.fuelCost">
                  {(field) => (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fuel Cost (PKR)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(Number(e.target.value))}
                      />
                    </div>
                  )}
                </form.Field>
              )}

              <form.Field name="trip.notes">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trip Notes</Label>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Any trip notes..."
                    />
                  </div>
                )}
              </form.Field>
            </div>

            {blockedReason && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {blockedReason}
              </div>
            )}
          </div>

          {/* ── Commission Thresholds (visible when OB selected) ── */}
          {orderBookerId && (
            <div className="border rounded-lg p-3 bg-muted/10">
              <CommissionThresholdsPanel
                tiers={commissionTiers ?? []}
                flatRate={flatCommissionRate}
                totalSale={totalSale}
              />
            </div>
          )}

          {/* ── Line Items ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Order Items
              </Label>
              <span className="text-[10px] text-muted-foreground">
                {items.length} line{items.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="space-y-4">
              {items.map((item, index) => (
                <OrderLineItem
                  key={index}
                  index={index}
                  item={item}
                  products={products ?? []}
                  form={form}
                  obRateMap={obRateMap}
                  isManualOverride={manualRateOverrides.has(index)}
                  onProductChange={handleProductChange}
                  onRecipeChange={handleRecipeChange}
                  onRateManualChange={handleRateManualChange}
                  onResetRate={resetRate}
                  onRemove={() => {
                    const current = form.getFieldValue("items");
                    if (current.length > 1) {
                      form.setFieldValue("items", current.filter((_, i) => i !== index));
                      setManualRateOverrides((prev) => {
                        const next = new Set<number>();
                        prev.forEach((idx) => {
                          if (idx < index) next.add(idx);
                          if (idx > index) next.add(idx - 1);
                        });
                        return next;
                      });
                    }
                  }}
                  canRemove={items.length > 1}
                />
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const current = form.getFieldValue("items");
                form.setFieldValue("items", [...current, blankItem()]);
              }}
              className="w-full gap-2 border-dashed text-muted-foreground hover:text-foreground hover:border-primary h-9"
            >
              <Plus className="size-4" /> Add Product Line
            </Button>
          </div>

          {/* ── Order Summary ── */}
          <div className="border rounded-lg p-4 bg-muted/10 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Calculator className="size-3" />
              Order Summary
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <SummaryRow label="Total Sale" value={totalSale} />
              <SummaryRow label="OB Commission Rate" valueText={formatRate(obMarginRate)} />
              <SummaryRow label="OB Commission Amount" value={obMarginAmount} color="emerald" />
              <div className="col-span-2 md:col-span-1">
                <div className="text-[10px] text-muted-foreground">Final Total</div>
                <div className="text-lg font-black font-mono">{formatPKR(totalSale)}</div>
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <form.Field name="notes">
            {(field) => (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</Label>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Any special instructions..."
                />
              </div>
            )}
          </form.Field>

          {/* ── Submit ── */}
          <Button
            type="submit"
            className="w-full"
            disabled={create.isPending || isCheckingTripEligibility || !!blockedReason}
          >
            {create.isPending
              ? "Creating…"
              : isCheckingTripEligibility
                ? "Checking trip date..."
                : `Create Order · ${formatPKR(totalSale)}`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   ORDER LINE ITEM (extracted for cleanliness)
   ──────────────────────────────────────────────────────────────────────────── */

function OrderLineItem({
  index,
  item,
  products,
  form,
  obRateMap,
  isManualOverride,
  onProductChange,
  onRecipeChange,
  onRateManualChange,
  onResetRate,
  onRemove,
  canRemove,
}: {
  index: number;
  item: OrderItemForm;
  products: any[];
  form: any;
  obRateMap: Map<string, number>;
  isManualOverride: boolean;
  onProductChange: (idx: number, productId: string) => void;
  onRecipeChange: (
    idx: number,
    recipeId: string,
    selectedRecipe?: Pick<Recipe, "containersPerCarton">,
  ) => void;
  onRateManualChange: (idx: number, value: number) => void;
  onResetRate: (idx: number) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { data: recipeList } = useQuery({
    queryKey: ["recipesByProduct", item.productId],
    queryFn: () => getRecipesByProductFn({ data: { productId: item.productId } }),
    enabled: !!item.productId,
  });

  const selectedRecipe = recipeList?.find((r) => r.id === item.recipeId);
  const allowedUnitTypes = getAllowedOrderUnitTypes(
    selectedRecipe?.containersPerCarton,
  );
  const configuredRate = item.recipeId ? obRateMap.get(item.recipeId) : undefined;
  const hasConfiguredRate = configuredRate !== undefined && configuredRate > 0;
  const lineTotal = item.rate * item.quantity;

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      {/* Desktop Row */}
      <div className="hidden md:grid items-start gap-2 p-3" style={{ gridTemplateColumns: "1.5fr 1.5fr 1fr 0.7fr 1fr 32px" }}>
        {/* Product */}
        <form.Field name={`items[${index}].productId`} validators={{ onChange: z.string().min(1) }}>
          {(sf: AnyFieldApi) => (
            <Select value={sf.state.value} onValueChange={(v) => onProductChange(index, v)}>
              <SelectTrigger className={`h-9 text-xs ${sf.state.meta.errors.length > 0 ? "border-destructive" : ""}`}>
                <SelectValue placeholder="Select product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>

        {/* Recipe */}
        <form.Field name={`items[${index}].recipeId`} validators={{ onChange: z.string().min(1) }}>
          {(sf: AnyFieldApi) => (
            <Select
              value={sf.state.value}
              onValueChange={(v) =>
                onRecipeChange(
                  index,
                  v,
                  recipeList?.find((r) => r.id === v),
                )}
              disabled={!item.productId}
            >
              <SelectTrigger className={`h-9 text-xs ${sf.state.meta.errors.length > 0 ? "border-destructive" : ""}`}>
                <SelectValue placeholder={item.productId ? "Select recipe…" : "Select product first"} />
              </SelectTrigger>
              <SelectContent>
                {(recipeList || []).map((r: Recipe) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>

        {/* Unit Type */}
        <form.Field name={`items[${index}].unitType`} validators={{ onChange: z.string().min(1, "Required") }}>
          {(sf: AnyFieldApi) => (
            <Select
              value={sf.state.value}
              onValueChange={sf.handleChange}
              disabled={!selectedRecipe}
            >
              <SelectTrigger className={`h-9 text-xs ${sf.state.meta.errors.length > 0 ? "border-destructive" : ""}`}>
                <SelectValue placeholder={selectedRecipe ? "Select unit type…" : "Select recipe first"} />
              </SelectTrigger>
              <SelectContent>
                {allowedUnitTypes.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>

        {/* Quantity */}
        <form.Field name={`items[${index}].quantity`} validators={{ onChange: z.number().min(1) }}>
          {(sf: AnyFieldApi) => (
            <Input
              type="number"
              min={1}
              className={`h-9 text-xs ${sf.state.meta.errors.length > 0 ? "border-destructive" : ""}`}
              value={sf.state.value}
              onChange={(e) => sf.handleChange(Number(e.target.value))}
            />
          )}
        </form.Field>

        {/* Rate */}
        <form.Field name={`items[${index}].rate`}>
          {(sf: AnyFieldApi) => (
            <div className="relative">
              <Input
                type="number"
                min={0}
                className={`h-9 text-xs pl-6 ${isManualOverride ? "border-amber-500/50" : !hasConfiguredRate && item.recipeId ? "border-destructive/50" : ""}`}
                value={sf.state.value}
                onChange={(e) => onRateManualChange(index, Number(e.target.value))}
                aria-label="Rate per carton"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-semibold pointer-events-none">₨</span>
            </div>
          )}
        </form.Field>

        {/* Remove */}
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} disabled={!canRemove} className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 mt-0.5" aria-label="Remove line item">
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Mobile */}
      <div className="md:hidden p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">Line #{index + 1}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!canRemove} className="h-7 text-destructive hover:bg-destructive/10" aria-label="Remove line item">
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <form.Field name={`items[${index}].productId`}>
            {(sf: AnyFieldApi) => (
              <Select value={sf.state.value} onValueChange={(v) => onProductChange(index, v)}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="Product…" /></SelectTrigger>
                <SelectContent>
                  {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <form.Field name={`items[${index}].recipeId`}>
            {(sf: AnyFieldApi) => (
              <Select
                value={sf.state.value}
                onValueChange={(v) =>
                  onRecipeChange(
                    index,
                    v,
                    recipeList?.find((r) => r.id === v),
                  )}
                disabled={!item.productId}
              >
                <SelectTrigger className="text-xs"><SelectValue placeholder="Recipe…" /></SelectTrigger>
                <SelectContent>
                  {(recipeList || []).map((r: Recipe) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <form.Field name={`items[${index}].unitType`}>
            {(sf: AnyFieldApi) => (
              <Select
                value={sf.state.value}
                onValueChange={sf.handleChange}
                disabled={!selectedRecipe}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder={selectedRecipe ? "Unit type…" : "Select recipe first"} />
                </SelectTrigger>
                <SelectContent>
                  {allowedUnitTypes.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <form.Field name={`items[${index}].quantity`}>
            {(sf: AnyFieldApi) => (
              <Input type="number" min={1} className="text-xs" value={sf.state.value} onChange={(e) => sf.handleChange(Number(e.target.value))} />
            )}
          </form.Field>
        </div>
      </div>

      {/* Rate summary (shown when recipe selected) */}
      {item.recipeId && selectedRecipe && (
        <div className="border-t px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {selectedRecipe.name}
              </span>
              {hasConfiguredRate ? (
                <span className="text-[10px] text-muted-foreground">
                  Configured carton rate: {formatPKR(configuredRate!)}
                  {selectedRecipe.containersPerCarton
                    ? ` · ~${formatPKR(configuredRate! / selectedRecipe.containersPerCarton)}/pack`
                    : ""}
                </span>
              ) : (
                <span className="text-[10px] text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="size-2.5" />
                  No rate configured for this order booker — enter manually
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isManualOverride && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px] gap-1"
                  onClick={() => onResetRate(index)}
                >
                  <RotateCcw className="size-3" />
                  Reset
                </Button>
              )}
              <div className="text-right">
                <span className="text-[10px] text-muted-foreground">Line Total</span>
                <div className="text-sm font-bold font-mono">{formatPKR(lineTotal)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueText,
  color,
}: {
  label: string;
  value?: number;
  valueText?: string;
  color?: "emerald";
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-bold font-mono ${color === "emerald" ? "text-emerald-400" : ""}`}>
        {valueText ?? formatPKR(value ?? 0)}
      </div>
    </div>
  );
}
