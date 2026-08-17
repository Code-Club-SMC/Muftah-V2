// -nocheck
import React, { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Layers, Users, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    calculateInvoiceLinePricing,
    roundMoney,
    normalizeInvoicePricingMode,
    safeContainersPerCarton,
    type InvoiceLinePricingBreakdown,
    type InvoicePricingMode,
} from "@/lib/sales/invoice-line-pricing";

export { roundMoney };

// ── Types ────────────────────────────────────────────────────────────────────

export type ItemFormValue = {
    pack: string;
    recipeId: string;
    unitType: "carton" | "units";
    numberOfCartons: number;
    numberOfUnits: number;
    discountCartons: number;
    packsPerCarton: number;
    hsnCode: string;
    perCartonPrice: number;
    retailPrice: number;
    isPriceOverride?: boolean;
    preserveStoredDistributorRate?: boolean;
    legacyBaseCartonRate?: number;
};

export type StockItem = {
    id: string;
    recipeId: string;
    recipe?: {
        name?: string;
        hsnCode?: string;
        productId?: string | null | undefined;
        containersPerCarton?: number | string | null | undefined;
        estimatedCostPerContainer?: number | string | null | undefined;
    };
    quantityCartons?: number;
    quantityContainers?: number;
    weightedAverageCostPerPack?: number | string | null | undefined;
    weightedAverageCostPerCarton?: number | string | null | undefined;
};

export type RecipePriceEntry = {
    invoicePricePerPack: number;
    retailPricePerPack: number;
    baseRateSource?: "global_recipe_rate" | "general_recipe_rate" | "distributor_recipe_rate" | "order_booker_recipe_rate";
    baseRateLabel?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export const PKR = (v: number, decimals = 2) =>
    `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

export function getCartonRateHoverLines({
    containersPerCarton,
    liveUnitCostPerPack,
    pricingSourceLabel,
    effectiveCartonRate,
    defaultMarginPercent = 0,
    isDistributor = false,
    usesStoredDistributorRate = false,
    isPriceOverride = false,
}: {
    containersPerCarton: number;
    liveUnitCostPerPack: number;
    pricingSourceLabel?: string | null;
    effectiveCartonRate: number;
    defaultMarginPercent?: number;
    isDistributor?: boolean;
    usesStoredDistributorRate?: boolean;
    isPriceOverride?: boolean;
}) {
    const lines: string[] = [];
    const normalizedContainersPerCarton = safeEffectiveCPP(containersPerCarton);
    const normalizedUnitCost = roundMoney(Math.max(0, Number(liveUnitCostPerPack || 0)));
    const baseCartonCost = roundMoney(normalizedContainersPerCarton * normalizedUnitCost);

    if (normalizedUnitCost > 0) {
        lines.push(
            `Base cost: ${normalizedContainersPerCarton} pks × ₨${normalizedUnitCost.toFixed(2)} = ${PKR(baseCartonCost)}/ctn`,
        );
    }

    if (isPriceOverride) {
        lines.push("Manual carton rate override");
    } else if (pricingSourceLabel) {
        lines.push(pricingSourceLabel);
    }

    if (usesStoredDistributorRate) {
        lines.push(`Stored distributor sell rate -> ${PKR(effectiveCartonRate)}/ctn`);
    } else if (isDistributor && Number(defaultMarginPercent || 0) > 0) {
        lines.push(`Default margin ${defaultMarginPercent}% -> sell rate ${PKR(effectiveCartonRate)}/ctn`);
    } else {
        lines.push(`Sell rate ${PKR(effectiveCartonRate)}/ctn`);
    }

    return lines;
}

export const floorMoney = (value: number) => Math.floor(roundMoney(value));

export const getAutomaticRoundOff = (value: number) => roundMoney(roundMoney(value) - floorMoney(value));

export const safeEffectiveCPP = safeContainersPerCarton;

const toNumber = (value: number | string | null | undefined): number => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
};

export const getRecipeContainersPerCarton = (stock: StockItem | null, fallback = 1): number =>
    safeEffectiveCPP(toNumber(stock?.recipe?.containersPerCarton) || fallback);

export function getConfiguredBaseUnitRate(
    recipePricing?: RecipePriceEntry | null,
): number {
    const configuredInvoicePrice = toNumber(recipePricing?.invoicePricePerPack);
    return configuredInvoicePrice > 0 ? configuredInvoicePrice : 0;
}

// Mirrors server resolveConfiguredBaseCartonRate (invoice-posting-service.ts).
// Returns the carton rate the server will use for online invoices so the
// client total matches the server total. When no entity rate is configured,
// falls back to item.perCartonPrice (legacy / typed-in rate).
export function resolveClientBaseCartonRate({
    recipePricing,
    itemPerCartonPrice,
    containersPerCarton,
    isPriceOverride = false,
    preserveStoredDistributorRate = false,
}: {
    recipePricing?: RecipePriceEntry | null;
    itemPerCartonPrice?: number | null;
    containersPerCarton: number;
    isPriceOverride?: boolean;
    preserveStoredDistributorRate?: boolean;
}): number {
    const configuredPricePerPack = getConfiguredBaseUnitRate(recipePricing);
    const configuredCartonRate =
        configuredPricePerPack > 0
            ? roundMoney(configuredPricePerPack * containersPerCarton)
            : 0;

    if (!isPriceOverride && !preserveStoredDistributorRate && configuredCartonRate > 0) {
        return configuredCartonRate;
    }

    const itemRate = Number(itemPerCartonPrice ?? 0);
    if (itemRate > 0) return roundMoney(itemRate);

    return configuredCartonRate;
}

export function getLiveUnitCostPerPack(
    stock: StockItem | null,
    recipePricing?: RecipePriceEntry | null,
): number {
    const weightedAverageCostPerPack = toNumber(stock?.weightedAverageCostPerPack);
    if (weightedAverageCostPerPack > 0) {
        return weightedAverageCostPerPack;
    }

    const configuredInvoicePrice = toNumber(recipePricing?.invoicePricePerPack);
    if (configuredInvoicePrice > 0) {
        return configuredInvoicePrice;
    }

    const estimatedCostPerContainer = toNumber(stock?.recipe?.estimatedCostPerContainer);
    if (estimatedCostPerContainer > 0) {
        return estimatedCostPerContainer;
    }

    return 0;
}

export function getPreviewPerCartonPrice(
    stock: StockItem | null,
    recipePricing?: RecipePriceEntry | null,
    _customerDefaultMargin?: number | null,
    _applyDistributorPricing = false,
): number {
    const containersPerCarton = getRecipeContainersPerCarton(stock);
    const baseUnitRate = getConfiguredBaseUnitRate(recipePricing);
    if (baseUnitRate <= 0) {
        return 0;
    }

    return roundMoney(baseUnitRate * containersPerCarton);
}

export function getPreviewEffectiveCartonPrice(
    baseCartonRate: number,
    customerDefaultMargin?: number | null,
    applyDistributorPricing = false,
): number {
    const normalizedBaseCartonRate = roundMoney(Math.max(0, Number(baseCartonRate || 0)));
    if (
        !applyDistributorPricing ||
        !customerDefaultMargin ||
        customerDefaultMargin <= 0 ||
        normalizedBaseCartonRate <= 0
    ) {
        return normalizedBaseCartonRate;
    }

    return calculateInvoiceLinePricing({
        invoiceMode: "distributor",
        unitType: "carton",
        numberOfCartons: 1,
        numberOfUnits: 0,
        manualFreeCartons: 0,
        autoFreeCartons: 0,
        baseCartonRate: normalizedBaseCartonRate,
        containersPerCarton: 1,
        defaultMarginPercent: customerDefaultMargin,
    }).effectiveCartonRate;
}

export function getLineUnitCostPerPack(
    item: ItemFormValue,
    stock: StockItem | null,
    recipePricing?: RecipePriceEntry | null,
    pricingMode: InvoicePricingMode = "retailer",
): number {
    const containersPerCarton = getRecipeContainersPerCarton(stock, item.packsPerCarton || 1);

    if (pricingMode !== "distributor" && item.isPriceOverride && (item.perCartonPrice || 0) > 0) {
        return roundMoney((item.perCartonPrice || 0) / containersPerCarton);
    }

    return getLiveUnitCostPerPack(stock, recipePricing);
}

export function getLinePricingBreakdown(
    item: ItemFormValue,
    recipeContainersPerCarton: number,
    unitCostPerPack?: number,
    pricingMode: InvoicePricingMode = "retailer",
    freeCartons = 0,
    marginPercent = 0,
    configuredPricePerPack?: number,
): InvoiceLinePricingBreakdown {
    const eCPP = safeEffectiveCPP(recipeContainersPerCarton);
    const preserveStoredDistributorRate =
        pricingMode === "distributor" && Boolean(item.preserveStoredDistributorRate);

    const recipePricing: RecipePriceEntry | undefined =
        configuredPricePerPack != null
            ? { invoicePricePerPack: configuredPricePerPack, retailPricePerPack: 0 }
            : undefined;

    const baseCartonRate = resolveClientBaseCartonRate({
        recipePricing,
        itemPerCartonPrice: item.perCartonPrice,
        containersPerCarton: eCPP,
        isPriceOverride: Boolean(item.isPriceOverride),
        preserveStoredDistributorRate,
    });

    return calculateInvoiceLinePricing({
        invoiceMode: normalizeInvoicePricingMode(pricingMode),
        unitType: item.unitType,
        numberOfCartons: item.numberOfCartons || 0,
        numberOfUnits: item.numberOfUnits || 0,
        manualFreeCartons: item.discountCartons || 0,
        autoFreeCartons: freeCartons,
        baseCartonRate,
        containersPerCarton: eCPP,
        defaultMarginPercent: preserveStoredDistributorRate ? 0 : marginPercent,
        unitCostPerPack: unitCostPerPack ?? (baseCartonRate / eCPP),
    });
}

export function lineAmount(
    item: ItemFormValue,
    recipeContainersPerCarton: number,
    pricingMode: InvoicePricingMode = "retailer",
    freeCartons = 0,
    marginPercent = 0,
): number {
    return getLinePricingBreakdown(
        item,
        recipeContainersPerCarton,
        undefined,
        pricingMode,
        freeCartons,
        marginPercent,
    ).netAmount;
}

export function estimateLineProfit(
    item: ItemFormValue,
    recipeContainersPerCarton: number,
    unitCostPerPack?: number,
    pricingMode: InvoicePricingMode = "retailer",
    freeCartons = 0,
    marginPercent = 0,
): number {
    return getLinePricingBreakdown(
        item,
        recipeContainersPerCarton,
        unitCostPerPack,
        pricingMode,
        freeCartons,
        marginPercent,
    ).profit;
}

export function findStock(availableStock: any[], recipeId: string) {
    return availableStock.find((s) => s.recipeId === recipeId) ?? null;
}

// ── UI primitives ───────────────────────────────────────────────────────────

export const Section = ({
    icon: Icon,
    title,
    subtitle,
    children,
    className,
    step,
    action,
}: {
    icon: React.ElementType;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    className?: string;
    step?: number;
    action?: React.ReactNode;
}) => (
    <div className={cn("rounded-2xl border bg-card shadow-sm overflow-hidden", className)}>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b bg-muted/20">
            <div className="flex items-center gap-3">
                {step !== undefined && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
                        {step}
                    </span>
                )}
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-3.5 text-primary" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold leading-none tracking-tight">{title}</h3>
                    {subtitle && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">{subtitle}</p>
                    )}
                </div>
            </div>
            {action && <div>{action}</div>}
        </div>
        <div className="p-5">{children}</div>
    </div>
);

export const ModeToggle = ({
    value,
    onChange,
}: {
    value: "existing" | "new";
    onChange: (v: "existing" | "new") => void;
}) => (
    <div className="flex gap-1 p-1 bg-muted/50 rounded-xl w-fit border mb-5">
        {( ["existing", "new"] as const).map((mode) => (
            <button
                key={mode}
                type="button"
                onClick={() => onChange(mode)}
                className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150",
                    value === mode
                        ? "bg-background shadow-sm text-foreground border"
                        : "text-muted-foreground hover:text-foreground",
                )}
            >
                {mode === "existing" ? (
                    <><Users className="size-3.5" /> Existing</>
                ) : (
                    <><UserPlus className="size-3.5" /> New Customer</>
                )}
            </button>
        ))}
    </div>
);

export const CartonCompositionBadge = ({
    recipeDefault,
    effectiveValue,
}: {
    recipeDefault: number;
    effectiveValue: number;
}) => (
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger asChild>
                <Badge variant="secondary" className="text-[9px] px-1.5 h-5 cursor-help gap-1">
                    <Layers className="size-2.5" />
                    {effectiveValue === recipeDefault
                        ? `${recipeDefault} (default)`
                        : `${effectiveValue} / ${recipeDefault} default`}
                </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
                Recipe default: {recipeDefault} packs/carton
                {effectiveValue !== recipeDefault && ` · Override: ${effectiveValue}`}
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
);

// ── DirtyStateNotifier ───────────────────────────────────────────────────────
const DirtyEffect = ({ dirty, onDirtyChange }: { dirty: boolean; onDirtyChange: (isDirty: boolean) => void; }) => {
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
    return null;
};

export const DirtyStateNotifier = ({ form, onDirtyChange }: { form: any; onDirtyChange: (isDirty: boolean) => void; }) => (
    <form.Subscribe selector={(s: any) => s.isDirty}>
        {(dirty: boolean) => <DirtyEffect dirty={dirty} onDirtyChange={onDirtyChange} />}
    </form.Subscribe>
);

export const blankItem = (): ItemFormValue => ({
    pack: "",
    recipeId: "",
    unitType: "carton",
    numberOfCartons: 1,
    numberOfUnits: 0,
    discountCartons: 0,
    packsPerCarton: 0,
    hsnCode: "",
    perCartonPrice: 0,
    retailPrice: 0,
    isPriceOverride: false,
    preserveStoredDistributorRate: false,
    legacyBaseCartonRate: 0,
});

export default {} as any;
