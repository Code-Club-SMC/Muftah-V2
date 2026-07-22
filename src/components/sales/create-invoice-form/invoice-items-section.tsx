import { useCallback, useEffect } from "react";
import { z } from "zod";
import {
    Plus, Trash2, Package, AlertCircle, CheckCircle2, Layers, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { ItemFormValue, StockItem } from "./utils";
import {
    PKR, safeEffectiveCPP,
    findStock, CartonCompositionBadge, blankItem,
    getLinePricingBreakdown,
    getLineUnitCostPerPack, getLiveUnitCostPerPack,
    getPreviewPerCartonPrice,
    getCartonRateHoverLines,
    type RecipePriceEntry,
} from "./utils";
import {
    getApplicableDistributorFreeCartons,
    selectApplicableDistributorDiscountRule,
} from "@/lib/sales/distributor-discount-rules";

const roundMoney = (value: number) => Number(value.toFixed(2));

type InvoiceItemsSectionProps = {
    form: any;
    items: ItemFormValue[];
    availableStock: StockItem[];
    activeWarehouse: string;
    totalAmount: number;
    getCartonInfo: (recipeId: string) => any;
    handleFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
    recipePriceMap?: Map<string, RecipePriceEntry>;
    discountRuleMap?: Map<string, any[]>;
    isDistributor?: boolean;
    preserveOrderLineRate?: boolean;
    customerDefaultMargin?: number;
};

function getReservedUnitsForRecipe(
    items: ItemFormValue[],
    availableStock: StockItem[],
    recipeId: string,
    excludeIndex: number,
    discountRuleMap: Map<string, any[]>,
) {
    return items.reduce((sum, currentItem, currentIndex) => {
        if (currentIndex === excludeIndex || currentItem.recipeId !== recipeId) {
            return sum;
        }

        const stock = findStock(availableStock, recipeId);
        const unitsPerCarton = safeEffectiveCPP(Number(stock?.recipe?.containersPerCarton || currentItem.packsPerCarton || 1));
        if (currentItem.unitType === "carton") {
            const recipeRules = discountRuleMap.get(currentItem.recipeId) ?? [];
            const autoFreeCartons = getAutoDiscountCartons(currentItem, recipeRules);
            const manualFreeCartons = Math.max(0, Number(currentItem.discountCartons || 0));
            return sum + Math.max(0, Number(currentItem.numberOfCartons || 0) + autoFreeCartons + manualFreeCartons) * unitsPerCarton;
        }

        return sum + (currentItem.numberOfUnits || 0);
    }, 0);
}

function getReservedCartonsForRecipe(
    items: ItemFormValue[],
    recipeId: string,
    excludeIndex: number,
    discountRuleMap: Map<string, any[]>,
) {
    return items.reduce((sum, currentItem, currentIndex) => {
        if (
            currentIndex === excludeIndex ||
            currentItem.recipeId !== recipeId ||
            currentItem.unitType !== "carton"
        ) {
            return sum;
        }

        const recipeRules = discountRuleMap.get(currentItem.recipeId) ?? [];
        const autoFreeCartons = getAutoDiscountCartons(currentItem, recipeRules);
        const manualFreeCartons = Math.max(0, Number(currentItem.discountCartons || 0));
        return sum + Math.max(0, Number(currentItem.numberOfCartons || 0) + autoFreeCartons + manualFreeCartons);
    }, 0);
}

function getAutoDiscountCartons(item: ItemFormValue, rules: any[]) {
    if (item.unitType !== "carton" || !item.recipeId) return 0;

    if (!rules.length) {
        return 0;
    }

    return getApplicableDistributorFreeCartons({
        rules,
        recipeId: item.recipeId,
        numberOfCartons: item.numberOfCartons || 0,
        manualFreeCartons: item.discountCartons || 0,
    }).freeCartons;
}

export const InvoiceItemsSection = ({
    form,
    items,
    availableStock,
    activeWarehouse,
    totalAmount,
    getCartonInfo,
    handleFocus,
    recipePriceMap,
    discountRuleMap = new Map<string, any[]>(),
    isDistributor = false,
    preserveOrderLineRate = false,
    customerDefaultMargin = 0,
}: InvoiceItemsSectionProps) => {
    const getRecipePricing = useCallback((recipeId: string) => recipePriceMap?.get(recipeId), [recipePriceMap]);

    const applyRecipePricingDefaults = useCallback((recipeId: string, index: number) => {
        const stock = findStock(availableStock, recipeId);
        const recipePricing = getRecipePricing(recipeId);
        const perCartonPrice = getPreviewPerCartonPrice(
            stock,
            recipePricing,
            customerDefaultMargin,
            isDistributor,
        );

        form.setFieldValue(`items[${index}].pack`, stock?.recipe?.name || "");

        if (stock?.recipe?.hsnCode) {
            form.setFieldValue(`items[${index}].hsnCode`, stock.recipe.hsnCode);
        }

        if (perCartonPrice > 0) {
            form.setFieldValue(`items[${index}].perCartonPrice`, perCartonPrice);
        }

        if (recipePricing?.retailPricePerPack != null) {
            form.setFieldValue(`items[${index}].retailPrice`, roundMoney(recipePricing.retailPricePerPack));
        }

        form.setFieldValue(`items[${index}].isPriceOverride`, false);
        form.setFieldValue(`items[${index}].preserveStoredDistributorRate`, false);
    }, [availableStock, customerDefaultMargin, form, getRecipePricing, isDistributor]);

    // Keep manual free cartons within the entered carton quantity.
    useEffect(() => {
        if (!isDistributor) return;
        items.forEach((item, index) => {
            if (item.unitType !== "carton") return;
            const maxManualFreeCartons = Math.max(0, item.numberOfCartons || 0);
            const current = Number(form.getFieldValue(`items[${index}].discountCartons`) || 0);
            if (current > maxManualFreeCartons) {
                form.setFieldValue(`items[${index}].discountCartons`, maxManualFreeCartons);
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDistributor, items, discountRuleMap, form]);

    useEffect(() => {
        items.forEach((item, index) => {
            if (!item.recipeId || item.isPriceOverride) return;
            if (isDistributor && item.preserveStoredDistributorRate) return;

            const stock = findStock(availableStock, item.recipeId);
            const recipePricing = getRecipePricing(item.recipeId);
            const nextPerCartonPrice = getPreviewPerCartonPrice(
                stock,
                recipePricing,
                customerDefaultMargin,
                isDistributor,
            );
            const currentPerCartonPrice = roundMoney(Number(form.getFieldValue(`items[${index}].perCartonPrice`) || 0));
            const shouldPreserveExistingOrderRate =
                preserveOrderLineRate
                && !isDistributor
                && currentPerCartonPrice > 0
                && !item.isPriceOverride;

            if (shouldPreserveExistingOrderRate) return;

            if (nextPerCartonPrice <= 0) return;

            if (currentPerCartonPrice !== nextPerCartonPrice) {
                form.setFieldValue(`items[${index}].perCartonPrice`, nextPerCartonPrice);
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableStock, customerDefaultMargin, form, getRecipePricing, isDistributor, items, preserveOrderLineRate]);

    return (
    <form.Field name="items">
        {(field: any) => (
            <div className="space-y-3">

                {/* Desktop column headers */}
                <div
                    className="hidden md:grid items-center gap-2 px-3 pb-1 border-b"
                    style={{ gridTemplateColumns: "2.2fr 1fr 0.7fr 0.7fr 1.2fr 1fr 0.9fr 0.9fr 32px" }}
                >
                    {["Product", "Unit Type", "HSN", "Packs/Ctn", "Qty", "Carton Rate", "Gross Amount", "Net Amount", ""].map((h) => (
                        <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {h}
                        </div>
                    ))}
                </div>

                <div className="divide-y divide-border/40 rounded-xl border bg-muted/10 overflow-hidden">
                    {items.map((item, index) => {
                        // ── Per-item derived values
                        const stock = findStock(availableStock, item.recipeId);
                        const recipePricing = getRecipePricing(item.recipeId);
                        const recipeDefault = stock?.recipe?.containersPerCarton || 1;
                        const eCPP = safeEffectiveCPP(recipeDefault);
                        const liveUnitCost = getLiveUnitCostPerPack(stock, recipePricing);
                        const pricingPreviewPerCarton = getPreviewPerCartonPrice(
                            stock,
                            recipePricing,
                            customerDefaultMargin,
                            isDistributor,
                        );
                        const pricingMode = isDistributor ? "distributor" : "retailer";
                        const unitCostForProfit = getLineUnitCostPerPack(item, stock, recipePricing, pricingMode);
                        const otherReservedUnits = item.recipeId
                            ? getReservedUnitsForRecipe(items, availableStock, item.recipeId, index, discountRuleMap)
                            : 0;
                        const otherReservedCartons = item.recipeId
                            ? getReservedCartonsForRecipe(items, item.recipeId, index, discountRuleMap)
                            : 0;

                        const stockU = stock?.quantityContainers ?? 0;
                        const rawCartonInfo = getCartonInfo(item.recipeId);
                        const sellableCartonPacks = rawCartonInfo.totalPacks || 0;
                        const totalStockU = sellableCartonPacks + stockU;
                        const remainingUnitsForLine = Math.max(0, totalStockU - otherReservedUnits);
                        const remainingCompleteCartons = Math.max(0, (rawCartonInfo.completeCartons || 0) - otherReservedCartons);

                        const recipeRules = isDistributor && item.recipeId
                            ? (discountRuleMap.get(item.recipeId) ?? [])
                            : [];
                        const appliedDiscountRule = item.recipeId
                            ? selectApplicableDistributorDiscountRule(
                                recipeRules,
                                item.recipeId,
                                item.numberOfCartons || 0,
                            )
                            : null;
                        const autoFreeCartons = getAutoDiscountCartons(item, recipeRules);
                        const maxManualFreeCartons = Math.max(0, item.numberOfCartons || 0);
                        const manualFreeCartons = Math.max(0, Math.min(item.discountCartons || 0, maxManualFreeCartons));
                        const totalFreeCartons = manualFreeCartons + autoFreeCartons;
                        const requestedU = item.unitType === "carton"
                            ? ((item.numberOfCartons || 0) + totalFreeCartons) * eCPP
                            : (item.numberOfUnits || 0);
                        const pricingBreakdown = getLinePricingBreakdown(
                            { ...item, discountCartons: manualFreeCartons },
                            recipeDefault,
                            unitCostForProfit,
                            pricingMode,
                            autoFreeCartons,
                            isDistributor ? customerDefaultMargin : 0,
                        );
                        const unitMargin = pricingBreakdown.chargedUnits > 0 && unitCostForProfit > 0
                            ? pricingBreakdown.effectiveUnitRate - unitCostForProfit
                            : null;

                        const stockExceeded = stock !== null && requestedU > remainingUnitsForLine && totalStockU > 0;

                        const distributorRateAdjusted = isDistributor
                            && !item.isPriceOverride
                            && !item.preserveStoredDistributorRate
                            && pricingPreviewPerCarton > 0
                            && Math.abs(pricingBreakdown.effectiveCartonRate - pricingPreviewPerCarton) > 0.009;
                        const usesPreservedOrderLineRate = preserveOrderLineRate
                            && !isDistributor
                            && !item.isPriceOverride
                            && (item.perCartonPrice || 0) > 0;
                        const usesStoredDistributorRate = isDistributor && Boolean(item.preserveStoredDistributorRate);
                        const pricingSourceNote = usesStoredDistributorRate
                            ? "Stored invoice rate"
                            : usesPreservedOrderLineRate
                            ? "Order line rate"
                            : (recipePricing?.baseRateLabel ?? null);
                        const cartonRateHoverLines = getCartonRateHoverLines({
                            containersPerCarton: eCPP,
                            liveUnitCostPerPack: liveUnitCost,
                            pricingSourceLabel: pricingSourceNote,
                            effectiveCartonRate: pricingBreakdown.effectiveCartonRate,
                            defaultMarginPercent: customerDefaultMargin,
                            isDistributor,
                            usesStoredDistributorRate,
                            isPriceOverride: Boolean(item.isPriceOverride),
                        });

                        return (
                            <div
                                key={index}
                                className={cn(
                                    "px-3 py-3 transition-colors",
                                    stockExceeded && "bg-destructive/5",
                                    !stockExceeded && index % 2 === 1 && "bg-muted/20",
                                )}
                            >
                                {/* ── Desktop layout ── */}
                                <div
                                    className="hidden md:grid items-start gap-2"
                                    style={{ gridTemplateColumns: "2.2fr 1fr 0.7fr 0.7fr 1.2fr 1fr 0.9fr 0.9fr 32px" }}
                                >
                                    {/* Product */}
                                    <form.Field
                                        name={`items[${index}].recipeId`}
                                        validators={{
                                            onChange: z.string().min(1, "Select product"),
                                            onSubmit: z.string().min(1, "Select product"),
                                        }}
                                    >
                                        {(sf: any) => (
                                            <div className="space-y-1">
                                                <Select
                                                    value={sf.state.value}
                                                    onValueChange={(val) => {
                                                        sf.handleChange(val);
                                                        applyRecipePricingDefaults(val, index);
                                                    }}
                                                >
                                                    <SelectTrigger
                                                        className={cn(
                                                            "h-9 text-xs",
                                                            stockExceeded && "border-destructive",
                                                            !sf.state.value && sf.state.meta.isTouched && "border-destructive",
                                                        )}
                                                    >
                                                        <SelectValue placeholder="Select product…" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {availableStock
                                                            .filter((s) => {
                                                                const cInfo = getCartonInfo(s.recipeId);
                                                                const reservedCartons = getReservedCartonsForRecipe(items, s.recipeId, index, discountRuleMap);
                                                                return Math.max(0, (cInfo.completeCartons || 0) - reservedCartons) > 0;
                                                            })
                                                            .map((s) => {
                                                                const cInfo = getCartonInfo(s.recipeId);
                                                                const reservedCartons = getReservedCartonsForRecipe(items, s.recipeId, index, discountRuleMap);
                                                                const remainingCartons = Math.max(0, (cInfo.completeCartons || 0) - reservedCartons);
                                                                return (
                                                                    <SelectItem key={s.id} value={s.recipeId}>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium text-sm">{s.recipe?.name}</span>
                                                                            <Badge variant="secondary" className="text-[9px] px-1 h-4">
                                                                                {remainingCartons}C avail
                                                                            </Badge>
                                                                        </div>
                                                                    </SelectItem>
                                                                );
                                                            })}
                                                    </SelectContent>
                                                </Select>

                                                {/* Stock status indicator */}
                                                <div className="flex items-center gap-1 text-[10px]">
                                                    {stockExceeded ? (
                                                        <span className="text-destructive font-semibold flex items-center gap-0.5">
                                                            <AlertCircle className="size-3" aria-hidden="true" /> Exceeds stock
                                                        </span>
                                                    ) : stock ? (() => {
                                                        const hasComplete = remainingCompleteCartons > 0;
                                                        return (
                                                            <span className={cn("flex items-center gap-0.5", hasComplete ? "text-emerald-600" : "text-amber-600")}>
                                                                {hasComplete ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <AlertCircle className="size-3" aria-hidden="true" />}
                                                                {hasComplete
                                                                    ? `${remainingCompleteCartons} complete carton${remainingCompleteCartons !== 1 ? "s" : ""} available`
                                                                    : "No complete cartons available"}
                                                                {totalFreeCartons > 0 && (
                                                                    <span className="ml-1 text-purple-600 font-medium">+ {totalFreeCartons} scheme</span>
                                                                )}
                                                                {appliedDiscountRule && autoFreeCartons > 0 && (
                                                                    <span className="ml-1 text-purple-500 text-[9px]">(buy {appliedDiscountRule.quantityThreshold} get {appliedDiscountRule.freeUnits})</span>
                                                                )}
                                                            </span>
                                                        );
                                                    })() : (
                                                        <span className="text-muted-foreground">No stock info</span>
                                                    )}
                                                </div>

                                                {/* Free cartons — carton mode only */}
                                                {item.unitType === "carton" && (
                                                    <form.Field name={`items[${index}].discountCartons`}>
                                                        {(sf: any) => (
                                                            <div className="flex items-center gap-1 mt-1">
                                                                <span className="text-[9px] text-muted-foreground font-medium whitespace-nowrap">Manual free</span>
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    className="h-6 w-14 text-[10px] pr-1 pl-1.5"
                                                                    value={sf.state.value}
                                                                    onFocus={handleFocus}
                                                                    onChange={(e) => {
                                                                        const nextValue = Math.max(0, Number(e.target.value) || 0);
                                                                        sf.handleChange(Math.min(nextValue, maxManualFreeCartons));
                                                                    }}
                                                                    title="Manual free cartons dispatched on top of the entered quantity and not billed"
                                                                    aria-label="Manual free cartons"
                                                                />
                                                            </div>
                                                        )}
                                                    </form.Field>
                                                )}

                                                <FieldError errors={sf.state.meta.errors} />

                                                {item.unitType === "carton" && stock && (
                                                    <CartonCompositionBadge recipeDefault={recipeDefault} effectiveValue={eCPP} />
                                                )}
                                            </div>
                                        )}
                                    </form.Field>

                                    {/* Unit type */}
                                    <form.Field name={`items[${index}].unitType`}>
                                        {(sf: any) => (
                                            <Select
                                                value={sf.state.value}
                                                onValueChange={(v: any) => {
                                                    sf.handleChange(v);
                                                    if (v === "carton") {
                                                        form.setFieldValue(`items[${index}].numberOfUnits`, 0);
                                                    } else {
                                                        form.setFieldValue(`items[${index}].numberOfCartons`, 0);
                                                        form.setFieldValue(`items[${index}].discountCartons`, 0);
                                                    }
                                                }}
                                            >
                                                <SelectTrigger className="h-9 text-xs" aria-label="Select unit type"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="carton">
                                                        <span className="flex items-center gap-1.5 text-xs">
                                                            <Package className="size-3 text-primary" aria-hidden="true" /> Carton
                                                        </span>
                                                    </SelectItem>
                                                    <SelectItem value="units">
                                                        <span className="flex items-center gap-1.5 text-xs">
                                                            <Layers className="size-3 text-blue-500" aria-hidden="true" /> Loose
                                                        </span>
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </form.Field>

                                    {/* HSN */}
                                    <form.Field name={`items[${index}].hsnCode`}>
                                        {(sf: any) => (
                                            <Input
                                                className={cn("h-9 text-xs", sf.state.meta.errors.length > 0 && "border-destructive")}
                                                placeholder="HSN"
                                                value={sf.state.value}
                                                onChange={(e) => sf.handleChange(e.target.value)}
                                                aria-label="HSN code"
                                            />
                                        )}
                                    </form.Field>

                                    {/* Packs/Ctn — read-only recipe default */}
                                    <div className="flex items-center justify-center h-9 text-xs tabular-nums text-muted-foreground bg-muted/30 rounded-md px-2">
                                        {item.unitType === "carton" ? `${eCPP} pk/ctn` : "—"}
                                    </div>

                                    {/* Qty */}
                                    <div>
                                        {item.unitType === "carton" ? (
                                            <form.Field name={`items[${index}].numberOfCartons`}>
                                                {(sf: any) => {
                                                    const maxCartons = remainingCompleteCartons || 0;
                                                    return (
                                                        <div className="relative">
                                                            <Input
                                                                type="number"
                                                                min="0"
                                                                max={maxCartons > 0 ? maxCartons : undefined}
                                                                className={cn("h-9 text-xs pr-10", stockExceeded && "border-destructive")}
                                                                value={sf.state.value}
                                                                onFocus={handleFocus}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    const clamped = maxCartons > 0 ? Math.min(val, maxCartons) : val;
                                                                    sf.handleChange(clamped);
                                                                }}
                                                                aria-label="Number of cartons"
                                                            />
                                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-medium pointer-events-none">
                                                                ctn
                                                            </span>
                                                        </div>
                                                    );
                                                }}
                                            </form.Field>
                                        ) : (
                                            <form.Field name={`items[${index}].numberOfUnits`}>
                                                {(sf: any) => (
                                                    <div className="relative">
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            className={cn("h-9 text-xs pr-8", stockExceeded && "border-destructive")}
                                                            value={sf.state.value}
                                                            onFocus={handleFocus}
                                                            onChange={(e) => sf.handleChange(Number(e.target.value))}
                                                            aria-label="Number of units"
                                                        />
                                                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-medium pointer-events-none">
                                                            u
                                                        </span>
                                                    </div>
                                                )}
                                            </form.Field>
                                        )}
                                    </div>

                                    {/* Unit cost (per carton) */}
                                    <form.Field name={`items[${index}].perCartonPrice`}>
                                        {(sf: any) => (
                                            <div className="relative">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="h-9 text-xs pl-7"
                                                    value={sf.state.value}
                                                    onFocus={handleFocus}
                                                    onChange={(e) => {
                                                        sf.handleChange(Number(e.target.value));
                                                        form.setFieldValue(`items[${index}].isPriceOverride`, true);
                                                        form.setFieldValue(`items[${index}].preserveStoredDistributorRate`, false);
                                                    }}
                                                    aria-label="Price per carton"
                                                />
                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-semibold pointer-events-none">
                                                    ₨
                                                </span>
                                                <div className="mt-1 flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
                                                    <span>{pricingSourceNote ?? (distributorRateAdjusted ? "Pricing details" : "Pricing info")}</span>
                                                    <HoverCard openDelay={120} closeDelay={80}>
                                                        <HoverCardTrigger asChild>
                                                            <button
                                                                type="button"
                                                                className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                                                                aria-label="Carton rate pricing details"
                                                            >
                                                                <Info className="size-3" />
                                                            </button>
                                                        </HoverCardTrigger>
                                                        <HoverCardContent align="center" side="top" className="w-72 text-xs space-y-1.5">
                                                            {cartonRateHoverLines.map((line) => (
                                                                <p key={line}>{line}</p>
                                                            ))}
                                                        </HoverCardContent>
                                                    </HoverCard>
                                                </div>
                                            </div>
                                        )}
                                    </form.Field>

                                    {/* Gross Amount */}
                                    <div className="pt-0.5 space-y-1">
                                        <div className="font-bold text-sm text-right tabular-nums text-foreground">
                                            {PKR(pricingBreakdown.grossAmount)}
                                        </div>
                                        {pricingBreakdown.marginDeduction > 0 && (
                                            <div className="text-[10px] text-right tabular-nums text-amber-600">
                                                - {PKR(pricingBreakdown.marginDeduction)} margin
                                            </div>
                                        )}
                                    </div>

                                    {/* Net Amount */}
                                    <div className="pt-0.5 space-y-1">
                                        <div className="font-bold text-sm text-right tabular-nums text-foreground">
                                            {PKR(pricingBreakdown.netAmount)}
                                        </div>
                                        {pricingBreakdown.schemeDeduction > 0 && (
                                            <div className="text-[10px] text-right tabular-nums text-purple-600">
                                                - {PKR(pricingBreakdown.schemeDeduction)} free
                                            </div>
                                        )}
                                        {unitMargin !== null && (
                                            <div className={cn(
                                                "text-[10px] font-semibold text-right tabular-nums",
                                                unitMargin < 0 ? "text-destructive" : "text-emerald-600",
                                            )}>
                                                {unitMargin >= 0 ? "+" : ""}{PKR(unitMargin, 2)}/u
                                            </div>
                                        )}
                                    </div>

                                    {/* Remove */}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => field.removeValue(index)}
                                        disabled={field.state.value.length === 1}
                                        className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 mt-0.5"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>

                                {/* ── Mobile card ── */}
                                <div className="md:hidden space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-[10px] font-mono">
                                            Line #{index + 1}
                                        </Badge>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => field.removeValue(index)}
                                            disabled={field.state.value.length === 1}
                                            className="h-7 text-destructive hover:bg-destructive/10"
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    </div>

                                    {stockExceeded && (
                                        <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                                            <AlertCircle className="size-3.5 shrink-0" />
                                            Exceeds available stock: {remainingCompleteCartons}C / {Math.max(0, remainingUnitsForLine % eCPP)}U
                                        </div>
                                    )}

                                    <div className="space-y-3 text-sm">
                                        <form.Field name={`items[${index}].recipeId`}>
                                            {(sf: any) => (
                                                <div>
                                                    <label className="text-xs font-semibold">Product</label>
                                                    <Select value={sf.state.value} onValueChange={(val) => {
                                                        sf.handleChange(val);
                                                        applyRecipePricingDefaults(val, index);
                                                    }}>
                                                        <SelectTrigger className="text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                                                        <SelectContent>
                                                            {availableStock
                                                                .filter((s) => {
                                                                    const cInfo = getCartonInfo(s.recipeId);
                                                                    const reservedCartons = getReservedCartonsForRecipe(items, s.recipeId, index, discountRuleMap);
                                                                    return Math.max(0, (cInfo.completeCartons || 0) - reservedCartons) > 0;
                                                                })
                                                                .map((s) => (
                                                                    <SelectItem key={s.id} value={s.recipeId}>{s.recipe?.name}</SelectItem>
                                                                ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        </form.Field>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-xs font-semibold">Type</label>
                                                <form.Field name={`items[${index}].unitType`}>
                                                    {(sf: any) => (
                                                        <Select
                                                            value={sf.state.value}
                                                            onValueChange={(v: any) => {
                                                                sf.handleChange(v);
                                                                if (v === "carton") {
                                                                    form.setFieldValue(`items[${index}].numberOfUnits`, 0);
                                                                } else {
                                                                    form.setFieldValue(`items[${index}].numberOfCartons`, 0);
                                                                    form.setFieldValue(`items[${index}].discountCartons`, 0);
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="carton">Carton</SelectItem>
                                                                <SelectItem value="units">Loose</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                </form.Field>
                                            </div>
                                            <div>
                                                <label className="text-xs font-semibold">Qty</label>
                                                {item.unitType === "carton" ? (
                                                    <form.Field name={`items[${index}].numberOfCartons`}>
                                                        {(sf: any) => {
                                                            const maxCartons = remainingCompleteCartons || 0;
                                                            return (
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    max={maxCartons > 0 ? maxCartons : undefined}
                                                                    className="text-xs"
                                                                    value={sf.state.value}
                                                                    onFocus={handleFocus}
                                                                    onChange={(e) => {
                                                                        const val = Number(e.target.value);
                                                                        const clamped = maxCartons > 0 ? Math.min(val, maxCartons) : val;
                                                                        sf.handleChange(clamped);
                                                                    }}
                                                                />
                                                            );
                                                        }}
                                                    </form.Field>
                                                ) : (
                                                    <form.Field name={`items[${index}].numberOfUnits`}>
                                                        {(sf: any) => <Input type="number" min="0" className="text-xs" value={sf.state.value} onFocus={handleFocus} onChange={(e) => sf.handleChange(Number(e.target.value))} />}
                                                    </form.Field>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs font-semibold">Rate/Ctn</label>
                                            <form.Field name={`items[${index}].perCartonPrice`}>
                                                {(sf: any) => (
                                                    <div className="space-y-1">
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            className="text-xs"
                                                            value={sf.state.value}
                                                            onFocus={handleFocus}
                                                            onChange={(e) => {
                                                                sf.handleChange(Number(e.target.value));
                                                                form.setFieldValue(`items[${index}].isPriceOverride`, true);
                                                                form.setFieldValue(`items[${index}].preserveStoredDistributorRate`, false);
                                                            }}
                                                            aria-label="Price per carton"
                                                        />
                                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                            <span>{pricingSourceNote ?? (distributorRateAdjusted ? "Pricing details" : "Pricing info")}</span>
                                                            <HoverCard openDelay={120} closeDelay={80}>
                                                                <HoverCardTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                                                                        aria-label="Carton rate pricing details"
                                                                    >
                                                                        <Info className="size-3" />
                                                                    </button>
                                                                </HoverCardTrigger>
                                                                <HoverCardContent align="start" side="top" className="w-72 text-xs space-y-1.5">
                                                                    {cartonRateHoverLines.map((line) => (
                                                                        <p key={line}>{line}</p>
                                                                    ))}
                                                                </HoverCardContent>
                                                            </HoverCard>
                                                        </div>
                                                    </div>
                                                )}
                                            </form.Field>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 border-t pt-2">
                                            <div className="space-y-1">
                                                <span className="text-xs text-muted-foreground">Gross Amount</span>
                                                <div className="font-bold">{PKR(pricingBreakdown.grossAmount)}</div>
                                                {pricingBreakdown.marginDeduction > 0 && (
                                                    <p className="text-[10px] text-amber-600">
                                                        - {PKR(pricingBreakdown.marginDeduction)} margin
                                                    </p>
                                                )}
                                            </div>
                                            <div className="space-y-1 text-right">
                                                <span className="text-xs text-muted-foreground">Net Amount</span>
                                                <div className="font-bold">{PKR(pricingBreakdown.netAmount)}</div>
                                                {pricingBreakdown.schemeDeduction > 0 && (
                                                    <p className="text-[10px] text-purple-600">
                                                        - {PKR(pricingBreakdown.schemeDeduction)} free
                                                    </p>
                                                )}
                                                {unitMargin !== null && (
                                                    <p className={cn(
                                                        "text-[10px] font-semibold tabular-nums",
                                                        unitMargin < 0 ? "text-destructive" : "text-emerald-600",
                                                    )}>
                                                        {unitMargin >= 0 ? "+" : ""}{PKR(unitMargin, 2)}/u
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Add line button */}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => field.pushValue(blankItem())}
                    disabled={!activeWarehouse}
                    className="w-full gap-2 border-dashed text-muted-foreground hover:text-foreground hover:border-primary mt-1 h-9"
                >
                    <Plus className="size-4" /> Add Product Line
                </Button>

                {/* Running subtotal */}
                {totalAmount > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 bg-primary/5 rounded-lg border border-primary/20 mt-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                            Net Items Total · {items.length} item{items.length !== 1 ? "s" : ""}
                        </span>
                        <span className="text-sm font-extrabold text-primary tabular-nums">
                            {PKR(totalAmount)}
                        </span>
                    </div>
                )}
            </div>
        )}
    </form.Field>
);
};
