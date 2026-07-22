// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createInvoiceSchema } from "@/db/zod_schemas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetAllCustomers } from "@/hooks/sales/use-customers";
import { useCreateInvoice, useUpdateInvoice } from "@/hooks/sales/use-invoices";
import { useWallets } from "@/hooks/finance/use-finance";
import { useGetRecipePrices } from "@/hooks/sales/use-sales-config";
import { useGetRecipeRatesForEntity } from "@/hooks/sales/use-entity-recipe-rates";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { getCartonAvailabilityFn } from "@/server-functions/inventory/get-carton-availability-fn";
import { useGetDistributorDiscountRules } from "@/hooks/sales/use-discount-rules";
import { GENERAL_RECIPE_RATE_ENTITY_ID } from "@/lib/sales/entity-recipe-rate-config";
import { getApplicableDistributorFreeCartons } from "@/lib/sales/distributor-discount-rules";
import {
    AlertCircle,
    BanknoteIcon,
    Building2Icon,
    ChevronRight,
    Info,
    Loader2,
    MapPin,
    Phone,
    Warehouse,
    BadgeCheck,
    Percent,
    FileText,
    Tag,
} from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { ItemFormValue, StockItem, RecipePriceEntry } from "./create-invoice-form/utils";
import { PKR, findStock, Section, ModeToggle, DirtyStateNotifier, blankItem, getLinePricingBreakdown, roundMoney, getLineUnitCostPerPack } from "./create-invoice-form/utils";
import { InvoiceItemsSection } from "./create-invoice-form/invoice-items-section";
import { SettlementSection } from "./create-invoice-form/settlement-section";

type Props = {
    onSuccess: () => void;
    onCancel: () => void;
    onDirtyChange?: (isDirty: boolean) => void;
    initialData?: any;
    defaultCustomerType?: "distributor" | "retailer" | "wholesaler";
    lockedCustomerType?: boolean;
};

type InvoiceFormValues = {
    customerId: string;
    customerName: string;
    customerMobile: string;
    customerCnic: string;
    customerCity: string;
    customerState: string;
    customerBankAccount: string;
    customerType: "distributor" | "retailer" | "wholesaler";
    warehouseId: string;
    account: string;
    cash: number;
    credit: number;
    creditReturnDate: string;
    expenses: number;
    expensesDescription: string;
    invoiceDiscount: number;
    invoiceDiscountDescription: string;
    remarks: string;
    items: ItemFormValue[];
};

function normalizeInvoiceCustomerType(
    rawCustomerType: string | null | undefined,
): InvoiceFormValues["customerType"] {
    if (rawCustomerType === "distributor") return "distributor";
    if (rawCustomerType === "wholesaler") return "wholesaler";
    return "retailer";
}

function deriveLegacyDistributorPricingState(rawItem: Record<string, unknown>, initialCustomerType: InvoiceFormValues["customerType"], isExistingInvoice: boolean) {
    if (initialCustomerType !== "distributor" || !isExistingInvoice || Boolean((rawItem as any).isPriceOverride)) {
        return {
            preserveStoredDistributorRate: false,
            legacyBaseCartonRate: 0,
        };
    }

    const tpPrice = Number((rawItem as any).tpPrice || 0);
    const marginPercent = Number((rawItem as any).marginPercent || 0);
    const numberOfCartons = Number((rawItem as any).numberOfCartons || 0);
    const manualFreeCartons = Number((rawItem as any).discountCartons || 0);
    const autoFreeCartons = Number((rawItem as any).freeCartons || 0);
    const chargedCartons = Math.max(0, numberOfCartons - manualFreeCartons - autoFreeCartons);
    const currentPerCartonPrice = roundMoney(Number((rawItem as any).perCartonPrice || 0));
    const netAmount = roundMoney(Number((rawItem as any).amount || 0));
    const effectiveCartonRate = chargedCartons > 0 ? roundMoney(netAmount / chargedCartons) : 0;
    const inferredBaseCartonRate = tpPrice > 0
        ? roundMoney(tpPrice)
        : (
            marginPercent > 0
                ? roundMoney(currentPerCartonPrice / Math.max(0.0001, 1 - marginPercent / 100))
                : 0
        );
    const looksLegacyStoredDistributorRate = currentPerCartonPrice > 0
        && chargedCartons > 0
        && Math.abs(effectiveCartonRate - currentPerCartonPrice) < 0.02
        && inferredBaseCartonRate > currentPerCartonPrice + 0.009;

    return {
        preserveStoredDistributorRate: looksLegacyStoredDistributorRate,
        legacyBaseCartonRate: looksLegacyStoredDistributorRate ? inferredBaseCartonRate : 0,
    };
}


export const CreateInvoiceForm = ({ onSuccess, onCancel, onDirtyChange, initialData, defaultCustomerType, lockedCustomerType }: Props) => {
    const { data: customers } = useGetAllCustomers();
    const isDistributorLocked = lockedCustomerType && defaultCustomerType === "distributor";
    const initialCustomerType = normalizeInvoiceCustomerType(
        initialData?.customerType || initialData?.customer?.customerType || defaultCustomerType || "retailer",
    );
    const isDistributorContext = isDistributorLocked || initialCustomerType === "distributor";

    const filteredCustomers = useMemo(() => {
        if (!customers) return [];
        if (isDistributorContext) {
            return customers.filter((c: any) => c.customerType === "distributor");
        }
        return customers.filter((c: any) => c.customerType !== "distributor");
    }, [customers, isDistributorContext]);

    const selectedCustomer = useMemo(() => {
        const customerId = initialData ? (initialData.customerId || "") : "";
        if (!customerId || !customers) return null;
        return customers.find((c: any) => c.id === customerId) || null;
    }, [customers, initialData]);

    const { data: inventoryData } = useSuspenseQuery({
        queryKey: ["inventory"],
        queryFn: () => getInventoryFn(),
    });
    const { data: walletsData } = useWallets();
    const { data: recipePricesData } = useGetRecipePrices();
    const wallets = walletsData || [];
    const warehouses = inventoryData ?? [];
    const resolvedInitialWarehouseId = initialData?.warehouseId || warehouses[0]?.id || "";

    const [customerMode, setCustomerMode] = useState<"existing" | "new">(
        isDistributorContext ? "existing" : (initialData?.customerId ? "existing" : (initialData?.customerName ? "new" : "existing"))
    );
    const [activeWarehouse, setActiveWarehouse] = useState<string>(resolvedInitialWarehouseId);
    const [availableStock, setAvailableStock] = useState<StockItem[]>([]);
    const isOrderConversionContext = !isDistributorContext && !!initialData?.orderId;
    const orderPreview = !isDistributorContext ? initialData?.orderPreview : null;
    const orderBookerPricingEntityId = !isDistributorContext
        ? (initialData?.orderBookerId || initialData?.order?.orderBookerId || "")
        : "";

    const recipePriceMap = useMemo(() => {
        const map = new Map<string, RecipePriceEntry>();
        if (!recipePricesData) return map;
        for (const rp of recipePricesData) {
            if (rp.invoicePricePerPack != null && rp.retailPricePerPack != null) {
                map.set(rp.recipeId, {
                    invoicePricePerPack: Number(rp.invoicePricePerPack),
                    retailPricePerPack: Number(rp.retailPricePerPack),
                    baseRateSource: "global_recipe_rate",
                    baseRateLabel: "Global recipe rate",
                });
            }
        }
        return map;
    }, [recipePricesData]);

    const { data: cartonAvailability } = useQuery({
        queryKey: ["carton-availability", activeWarehouse],
        queryFn: () => getCartonAvailabilityFn({ data: { warehouseId: activeWarehouse } }),
        enabled: !!activeWarehouse,
    });

    const getCartonInfo = useCallback((recipeId: string) => {
        const info = cartonAvailability?.find((c) => c.recipeId === recipeId);
        return info ?? { completeCartons: 0, partialCartons: 0, totalPacks: 0 };
    }, [cartonAvailability]);

    useEffect(() => {
        if (activeWarehouse) {
            const warehouse = warehouses.find((warehouse: { id: string }) => warehouse.id === activeWarehouse);
            setAvailableStock((warehouse?.finishedGoodsStock ?? []) as unknown as StockItem[]);
        }
    }, [activeWarehouse, warehouses]);

    const { mutateAsync: createInvoice, isPending: isCreating } = useCreateInvoice();
    const { mutateAsync: updateInvoice, isPending: isUpdating } = useUpdateInvoice();
    const isPending = isCreating || isUpdating;

    const form = useForm({
        defaultValues: initialData ? {
            customerId: initialData.customerId || "",
            customerName: initialData.customerName || "",
            customerMobile: initialData.customerMobile || "",
            customerCnic: "",
            customerCity: "",
            customerState: "",
            customerBankAccount: "",
            customerType: initialCustomerType,
            warehouseId: resolvedInitialWarehouseId,
            account: initialData.account || (wallets[0]?.id || ""),
            cash: Number(initialData.cash) || 0,
            credit: Number(initialData.credit) || 0,
            creditReturnDate: initialData.creditReturnDate ? new Date(initialData.creditReturnDate).toISOString().split("T")[0] : "",
            expenses: Number(initialData.expenses) || 0,
            expensesDescription: initialData.expensesDescription || "",
            invoiceDiscount: Number(initialData.invoiceDiscount) || 0,
            invoiceDiscountDescription: initialData.invoiceDiscountDescription || "",
            remarks: initialData.remarks || "",
            items: ((initialData?.items ?? []) as Array<Record<string, unknown>>).map((it): ItemFormValue => {
                const legacyPricingState = deriveLegacyDistributorPricingState(it, initialCustomerType, Boolean(initialData?.id));
                return ({
                pack: String((it as any).pack || ""),
                recipeId: String((it as any).recipeId || ""),
                unitType: Number((it as any).numberOfCartons) > 0 ? "carton" : "units",
                numberOfCartons: Number((it as any).numberOfCartons) || 0,
                numberOfUnits: Number((it as any).numberOfUnits ?? (it as any).quantity) || 0,
                discountCartons: Number((it as any).discountCartons) || 0,
                packsPerCarton: Number((it as any).actualPackSize ?? (it as any).packsPerCarton) || 0,
                hsnCode: String((it as any).hsnCode || ""),
                perCartonPrice: Number((it as any).perCartonPrice) || 0,
                retailPrice: Number((it as any).retailPrice) || 0,
                isPriceOverride: Boolean((it as any).isPriceOverride),
                preserveStoredDistributorRate: legacyPricingState.preserveStoredDistributorRate,
                legacyBaseCartonRate: legacyPricingState.legacyBaseCartonRate,
            });
            }),
        } : {
            customerId: "",
            customerName: "",
            customerMobile: "",
            customerCnic: "",
            customerCity: "",
            customerState: "",
            customerBankAccount: "",
            customerType: initialCustomerType,
            warehouseId: resolvedInitialWarehouseId,
            account: wallets[0]?.id || "",
            cash: 0,
            credit: 0,
            creditReturnDate: "",
            expenses: 0,
            expensesDescription: "",
            invoiceDiscount: 0,
            invoiceDiscountDescription: "",
            remarks: "",
            items: [blankItem()],
        },
        onSubmit: async ({ value }) => {
            const unfilledItems = value.items.filter((item) => !item.recipeId);
            if (unfilledItems.length > 0) {
                toast.error("All invoice lines must have a product selected.");
                return;
            }

            const pricingMode = value.customerType === "distributor" ? "distributor" : "retailer";
            const totalAmount = computeTotal(
                value.items,
                availableStock,
                pricingMode,
                discountRuleMap,
                pricingMode === "distributor" ? selectedCustomerDefaultMargin : 0,
            );
            const expenses = roundMoney(Number(value.expenses) || 0);
            const isRetailerInvoice = value.customerType === "retailer";
            const invoiceDiscount = isRetailerInvoice ? roundMoney(Number(value.invoiceDiscount) || 0) : 0;
            if (invoiceDiscount > totalAmount) {
                toast.error(`Discount (${PKR(invoiceDiscount)}) cannot exceed items total (${PKR(totalAmount)}).`);
                return;
            }
            const netSaleAmount = roundMoney(Math.max(0, totalAmount - invoiceDiscount));
            const totalPayable = roundMoney(netSaleAmount + expenses);
            const cashPaid = roundMoney(Number(value.cash) || 0);

            if (cashPaid > totalPayable && totalPayable > 0) {
                toast.error(`Cash received (${PKR(cashPaid)}) cannot exceed total payable (${PKR(totalPayable)}).`);
                return;
            }

            const credit = roundMoney(Math.max(0, totalPayable - cashPaid));
            if (credit > 0 && !value.creditReturnDate) {
                toast.error("Please set a credit due date when credit remains.");
                return;
            }

            try {
                const normalizedItems = value.items.map((item) => {
                    const migratedLegacyBaseCartonRate =
                        item.preserveStoredDistributorRate && Number(item.legacyBaseCartonRate || 0) > 0
                            ? roundMoney(Number(item.legacyBaseCartonRate || 0))
                            : null;
                    const preserveStoredDistributorRate = Boolean(item.preserveStoredDistributorRate && !migratedLegacyBaseCartonRate);
                    return {
                        ...item,
                        perCartonPrice: migratedLegacyBaseCartonRate ?? item.perCartonPrice,
                        isPriceOverride: Boolean(item.isPriceOverride || preserveStoredDistributorRate),
                        preserveStoredDistributorRate,
                        legacyBaseCartonRate: 0,
                    };
                });

                const payload = {
                    ...value,
                    items: normalizedItems,
                    customerName: customerMode === "existing" ? undefined : (value.customerName || undefined),
                    customerMobile: customerMode === "existing" ? undefined : (value.customerMobile || undefined),
                    customerCnic: customerMode === "existing" ? undefined : (value.customerCnic || undefined),
                    customerCity: customerMode === "existing" ? undefined : (value.customerCity || undefined),
                    customerState: customerMode === "existing" ? undefined : (value.customerState || undefined),
                    customerBankAccount: customerMode === "existing" ? undefined : (value.customerBankAccount || undefined),
                    customerId: customerMode === "existing" ? value.customerId : undefined,
                    warehouseId: activeWarehouse,
                    credit,
                    expenses,
                    expensesDescription: value.expensesDescription || undefined,
                    invoiceDiscount,
                    invoiceDiscountDescription: isRetailerInvoice ? (value.invoiceDiscountDescription || undefined) : undefined,
                    remarks: value.remarks || undefined,
                    creditReturnDate: value.creditReturnDate ? new Date(value.creditReturnDate) : undefined,
                    orderId: initialData?.orderId,
                };

                if (initialData?.id) {
                    await updateInvoice({ ...payload, id: initialData.id } as never);
                } else {
                    const validatedData = createInvoiceSchema.parse(payload);
                    await createInvoice(validatedData as any);
                }
                form.reset();
                onSuccess();
            } catch (error: unknown) {
                if (error instanceof z.ZodError) {
                    const friendlyMessages = error.issues.map((issue) => {
                        const path = issue.path.join(".");
                        const fieldLabels: Record<string, string> = {
                            customerId: "Customer",
                            customerName: "Customer name",
                            warehouseId: "Warehouse",
                            account: "Payment account",
                            creditReturnDate: "Credit return date",
                        };
                        const itemMatch = path.match(/^items\[(\d+)\]\.(\w+)$/);
                        if (itemMatch) {
                            const itemNum = Number(itemMatch[1]) + 1;
                            const field = itemMatch[2];
                            const labelMap: Record<string, string> = {
                                recipeId: "Product",
                                hsnCode: "HSN code",
                                perCartonPrice: "Price per carton",
                                retailPrice: "Retail price (MRP)",
                                pack: "Product name",
                            };
                            return `Item #${itemNum}: ${labelMap[field] ?? field} — ${issue.message}`;
                        }
                        return `${fieldLabels[path] ?? path} — ${issue.message}`;
                    });
                    toast.error("Please fix the following:\n" + friendlyMessages.join("\n"));
                } else {
                    toast.error((error instanceof Error ? error.message : "Something went wrong. Please try again."));
                }
            }
        },
    });

    useEffect(() => {
        form.setFieldValue("warehouseId", activeWarehouse);
    }, [activeWarehouse, form]);

    useEffect(() => {
        if (wallets.length > 0 && !form.getFieldValue("account")) {
            form.setFieldValue("account", wallets[0].id);
        }
    }, [wallets, form]);

    useEffect(() => {
        if (isDistributorContext) return;
        if (customerMode === "new") {
            form.setFieldValue("customerId", "");
        } else {
            form.setFieldValue("customerName", "");
            form.setFieldValue("customerMobile", "");
            form.setFieldValue("customerCnic", "");
            form.setFieldValue("customerCity", "");
            form.setFieldValue("customerState", "");
            form.setFieldValue("customerBankAccount", "");
            form.setFieldValue("customerType", normalizeInvoiceCustomerType(defaultCustomerType || "retailer"));
        }
    }, [customerMode, form, isDistributorContext, defaultCustomerType]);

    const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
        e.target.select();
    }, []);

    const selectedCustomerId = useStore(form.store, (s) => s.values.customerId);
    const selectedCustomerData = useMemo(() => {
        if (!selectedCustomerId || !customers) return null;
        return customers.find((c: any) => c.id === selectedCustomerId) || null;
    }, [selectedCustomerId, customers]);
    const selectedCustomerDefaultMargin = Number(selectedCustomerData?.defaultMargin || 0);

    // Fetch distributor-specific recipe rates when a distributor is selected
    const { data: distributorRecipeRates } = useGetRecipeRatesForEntity(
        "distributor",
        isDistributorContext ? selectedCustomerId : "",
        isDistributorContext && !!selectedCustomerId,
    );

    const { data: orderBookerRecipeRates } = useGetRecipeRatesForEntity(
        "order_booker",
        orderBookerPricingEntityId,
        !isDistributorContext && !!orderBookerPricingEntityId,
    );

    const { data: generalRecipeRates } = useGetRecipeRatesForEntity(
        "general",
        GENERAL_RECIPE_RATE_ENTITY_ID,
        !isDistributorContext,
    );

    // Overlay entity-specific configured carton rates into global recipe base rates.
    // Non-distributor priority: order booker -> general walk-in -> global recipe rate.
    const recipePriceMapWithEntityRates = useMemo(() => {
        const map = new Map(recipePriceMap);
        if (distributorRecipeRates && isDistributorContext) {
            for (const dr of distributorRecipeRates as any[]) {
                const containersPerCarton = Number(dr.containersPerCarton ?? 0);
                if (containersPerCarton <= 0) continue;
                const perPack = Number(dr.pricePerCarton) / containersPerCarton;
                const existing = map.get(dr.recipeId);
                map.set(dr.recipeId, {
                    invoicePricePerPack: perPack,
                    retailPricePerPack: existing?.retailPricePerPack ?? 0,
                    baseRateSource: "distributor_recipe_rate",
                    baseRateLabel: "Distributor recipe rate",
                });
            }
            return map;
        }

        if (generalRecipeRates && !isDistributorContext) {
            for (const gr of generalRecipeRates as any[]) {
                const containersPerCarton = Number(gr.containersPerCarton ?? 0);
                if (containersPerCarton <= 0) continue;
                const perPack = Number(gr.pricePerCarton) / containersPerCarton;
                const existing = map.get(gr.recipeId);
                map.set(gr.recipeId, {
                    invoicePricePerPack: perPack,
                    retailPricePerPack: existing?.retailPricePerPack ?? 0,
                    baseRateSource: "general_recipe_rate",
                    baseRateLabel: "General walk-in recipe rate",
                });
            }
        }

        if (orderBookerRecipeRates && orderBookerPricingEntityId) {
            for (const obr of orderBookerRecipeRates as any[]) {
                const containersPerCarton = Number(obr.containersPerCarton ?? 0);
                if (containersPerCarton <= 0) continue;
                const perPack = Number(obr.pricePerCarton) / containersPerCarton;
                const existing = map.get(obr.recipeId);
                map.set(obr.recipeId, {
                    invoicePricePerPack: perPack,
                    retailPricePerPack: existing?.retailPricePerPack ?? 0,
                    baseRateSource: "order_booker_recipe_rate",
                    baseRateLabel: "Order-booker recipe rate",
                });
            }
        }
        return map;
    }, [
        recipePriceMap,
        distributorRecipeRates,
        isDistributorContext,
        generalRecipeRates,
        orderBookerRecipeRates,
        orderBookerPricingEntityId,
    ]);

    useEffect(() => {
        if (customerMode === "existing" && selectedCustomerData?.customerType) {
            form.setFieldValue("customerType", normalizeInvoiceCustomerType(selectedCustomerData.customerType));
        }
    }, [customerMode, selectedCustomerData, form]);

    const { data: distributorDiscountRules } = useGetDistributorDiscountRules(
        isDistributorContext ? selectedCustomerId : "",
        isDistributorContext && !!selectedCustomerId,
    );

    // Build a map of recipeId → discount rule for fast lookup
    const discountRuleMap = useMemo(() => {
        const map = new Map<string, any[]>();
        if (!distributorDiscountRules) return map;
        for (const rule of distributorDiscountRules) {
            if (!rule.recipeId) continue;
            const existing = map.get(rule.recipeId) ?? [];
            existing.push(rule);
            map.set(rule.recipeId, existing);
        }
        return map;
    }, [distributorDiscountRules]);

    return (
        <form
            onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }}
            className="space-y-5 pb-12 mt-2"
        >
            {onDirtyChange && <DirtyStateNotifier form={form} onDirtyChange={onDirtyChange} />}

            <FieldGroup>
                <Section icon={Warehouse} title={isDistributorContext ? "Distributor" : "Customer"} subtitle={isDistributorContext ? "Select a pre-configured distributor" : "Who is this invoice for?"} step={1}>
                    {!isDistributorContext && <ModeToggle value={customerMode} onChange={setCustomerMode} />}
                    {customerMode === "existing" || isDistributorContext ? (
                        <form.Field
                            name="customerId"
                            validators={{
                                onChange: z.string().min(1, isDistributorContext ? "Please select a distributor" : "Please select a customer"),
                                onSubmit: z.string().min(1, isDistributorContext ? "Please select a distributor" : "Please select a customer"),
                            }}
                        >
                            {(field) => (
                                <Field>
                                    <FieldLabel>{isDistributorContext ? "Select Distributor" : "Select Customer"} <span className="text-destructive">*</span></FieldLabel>
                                    <Select value={field.state.value} onValueChange={field.handleChange}>
                                        <SelectTrigger className={cn("h-10", !field.state.value && field.state.meta.isTouched && "border-destructive")}>
                                            <SelectValue placeholder={isDistributorContext ? "Choose a distributor…" : "Choose a customer…"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                             {filteredCustomers.map((customer: { id: string; name: string; customerType?: string; defaultMargin?: string | number | null }) => (
                                                <SelectItem key={customer.id} value={customer.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{customer.name}</span>
                                                        {isDistributorContext && customer.defaultMargin != null && Number(customer.defaultMargin) > 0 && (
                                                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 gap-0.5">
                                                                <Percent className="size-2.5" />
                                                                {customer.defaultMargin}%
                                                            </Badge>
                                                        )}
                                                        {!isDistributorContext && (
                                                            <Badge variant="secondary" className="text-[9px] capitalize px-1.5 py-0 h-4">{customer.customerType}</Badge>
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
                    ) : null}
                    {isDistributorContext && selectedCustomerData && (
                        <div className="mt-3 p-3 rounded-lg bg-muted/40 border border-border/60 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1">
                                <Info className="size-3.5" />
                                Distributor Pricing Info
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex items-center gap-1.5 text-xs">
                                    <Percent className="size-3 text-muted-foreground" />
                                    <span className="text-muted-foreground">Default Margin:</span>
                                    <span className="font-semibold">{selectedCustomerData.defaultMargin || 0}%</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs">
                                    <FileText className="size-3 text-muted-foreground" />
                                    <span className="text-muted-foreground">Discount Rules:</span>
                                    <span className="font-semibold">{distributorDiscountRules?.length || 0}</span>
                                </div>
                            </div>
                        </div>
                    )}
                    {!isDistributorContext && customerMode === "new" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <form.Field name="customerName">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel><Warehouse className="size-3 mr-1 inline" /> Name <span className="text-destructive">*</span></FieldLabel>
                                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. Hamza Traders" className={cn(field.state.meta.errors.length > 0 && "border-destructive")} />
                                            <FieldError errors={field.state.meta.errors} />
                                        </Field>
                                    )}
                                </form.Field>
                                <form.Field name="customerMobile">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel><Phone className="size-3 mr-1 inline" /> Mobile <span className="ml-1 text-[10px] text-muted-foreground font-normal">(optional)</span></FieldLabel>
                                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="03xx-xxxxxxx" />
                                        </Field>
                                    )}
                                </form.Field>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <form.Field name="customerCnic">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel><BadgeCheck className="size-3 mr-1 inline" /> CNIC <span className="ml-1 text-[10px] text-muted-foreground font-normal">(optional)</span></FieldLabel>
                                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="xxxxx-xxxxxxx-x" />
                                        </Field>
                                    )}
                                </form.Field>
                                <form.Field name="customerCity">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel><MapPin className="size-3 mr-1 inline" /> City</FieldLabel>
                                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Lahore" />
                                        </Field>
                                    )}
                                </form.Field>
                                <form.Field name="customerState">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel>Province</FieldLabel>
                                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Punjab" />
                                        </Field>
                                    )}
                                </form.Field>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <form.Field name="customerBankAccount">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel><BanknoteIcon className="size-3 mr-1 inline" /> Bank / Wallet</FieldLabel>
                                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="IBAN or EasyPaisa / JazzCash" />
                                        </Field>
                                    )}
                                </form.Field>
                                <form.Field name="customerType">
                                    {(field) => (
                                        <Field>
                                            <FieldLabel>Customer Type</FieldLabel>
                                            <Select value={field.state.value} onValueChange={(v: any) => field.handleChange(v)}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="retailer">Retailer</SelectItem>
                                                    <SelectItem value="wholesaler">Wholesaler</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                    )}
                                </form.Field>
                            </div>
                        </div>
                    )}
                </Section>

                <Section icon={Warehouse} title="Dispatch Settings" subtitle="Source warehouse and deposit account" step={2}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <form.Field name="warehouseId">
                            {(field) => (
                                <Field>
                                    <FieldLabel>Source Warehouse <span className="text-destructive">*</span></FieldLabel>
                                    <Select value={activeWarehouse} onValueChange={(val: any) => { setActiveWarehouse(val); field.handleChange(val); }}>
                                        <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                                        <SelectContent>
                                             {warehouses.map((warehouse: { id: string; name: string; finishedGoodsStock?: unknown[] }) => (
                                                <SelectItem key={warehouse.id} value={warehouse.id}>
                                                    <div className="flex items-center gap-2">
                                                        <Warehouse className="size-3 text-muted-foreground" />
                                                        <span>{warehouse.name}</span>
                                                        {(warehouse.finishedGoodsStock?.length ?? 0) > 0 && <Badge variant="secondary" className="text-[9px] px-1.5 h-4">{warehouse.finishedGoodsStock?.length ?? 0} SKUs</Badge>}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FieldDescription>Stock will be deducted from here.</FieldDescription>
                                    <FieldError errors={field.state.meta.errors} />
                                </Field>
                            )}
                        </form.Field>

                        <form.Field name="account">
                            {(field) => (
                                <Field>
                                    <FieldLabel>Deposit Account <span className="text-destructive">*</span></FieldLabel>
                                    <Select value={field.state.value} onValueChange={field.handleChange}>
                                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                                        <SelectContent>
                                             {wallets.map((wallet: { id: string; name: string; type?: string }) => (
                                                <SelectItem key={wallet.id} value={wallet.id}>
                                                    <span className="flex items-center gap-2">
                                                        {wallet.type === "bank" ? <Building2Icon className="size-3.5 text-blue-500" /> : <BanknoteIcon className="size-3.5 text-emerald-500" />}
                                                        {wallet.name}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FieldDescription>Cash payments will be credited here.</FieldDescription>
                                    <FieldError errors={field.state.meta.errors} />
                                </Field>
                            )}
                        </form.Field>
                    </div>
                </Section>

                <form.Subscribe selector={(s) => s.values}>
                    {(values) => {
                        const items: ItemFormValue[] = values.items || [];
                        const expenses = roundMoney(Number(values.expenses) || 0);
                        const isRetailerInvoice = values.customerType === "retailer";
                        const isDistributorInvoice = values.customerType === "distributor";
                        const pricingMode = isDistributorInvoice ? "distributor" : "retailer";
                        const invoiceDiscount = isRetailerInvoice ? roundMoney(Number(values.invoiceDiscount) || 0) : 0;
                        const cashPaid = roundMoney(Number(values.cash) || 0);
                        const totalAmount = computeTotal(
                            items,
                            availableStock,
                            pricingMode,
                            discountRuleMap,
                            pricingMode === "distributor" ? selectedCustomerDefaultMargin : 0,
                        );
                        const appliedDiscount = Math.min(invoiceDiscount, totalAmount);
                        const totalProfit = roundMoney(
                            computeProfit(
                                items,
                                availableStock,
                                recipePriceMapWithEntityRates,
                                pricingMode,
                                discountRuleMap,
                                pricingMode === "distributor" ? selectedCustomerDefaultMargin : 0,
                            ) - appliedDiscount,
                        );
                        const grossPayable = roundMoney((totalAmount - appliedDiscount) + expenses);
                        const totalPayable = roundMoney(grossPayable);
                        const totalCredit = roundMoney(Math.max(0, totalPayable - cashPaid));
                        const cashExceedsTotal = cashPaid > totalPayable && totalPayable > 0;
                        const isFullyPaid = totalCredit === 0 && cashPaid > 0;

                        return (
                            <div className="space-y-5">
                                {isOrderConversionContext && orderPreview && (
                                    <Section
                                        icon={FileText}
                                        title="Booked Order Preview"
                                        subtitle={`Converted from booked order #${orderPreview.billNumber ?? initialData?.orderId}`}
                                    >
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        Order Booker
                                                    </p>
                                                    <p className="mt-1 text-sm font-semibold">
                                                        {orderPreview.orderBookerName || "—"}
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        Shopkeeper
                                                    </p>
                                                    <p className="mt-1 text-sm font-semibold">
                                                        {orderPreview.shopkeeperName || selectedCustomerData?.name || "—"}
                                                    </p>
                                                    {orderPreview.shopkeeperMobile && (
                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {orderPreview.shopkeeperMobile}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        Booked Value
                                                    </p>
                                                    <p className="mt-1 text-sm font-semibold tabular-nums">
                                                        {PKR(Number(orderPreview.totalAmount) || 0)}
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        Lines
                                                    </p>
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <p className="text-sm font-semibold">
                                                            {orderPreview.items?.length || 0}
                                                        </p>
                                                        {orderPreview.status && (
                                                            <Badge variant="secondary" className="capitalize">
                                                                {orderPreview.status}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="overflow-hidden rounded-xl border border-border/60">
                                                <div className="hidden grid-cols-[minmax(0,2fr)_0.9fr_0.9fr_1fr_1fr] gap-2 border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
                                                    <div>Product</div>
                                                    <div>Booked Unit</div>
                                                    <div className="text-right">Qty</div>
                                                    <div className="text-right">Rate</div>
                                                    <div className="text-right">Amount</div>
                                                </div>
                                                <div className="divide-y divide-border/60">
                                                    {(orderPreview.items ?? []).map((item: any, index: number) => (
                                                        <div
                                                            key={`${item.productName}-${index}`}
                                                            className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,2fr)_0.9fr_0.9fr_1fr_1fr] md:items-center"
                                                        >
                                                            <div className="font-medium">{item.productName}</div>
                                                            <div className="text-muted-foreground">{item.unitLabel}</div>
                                                            <div className="tabular-nums md:text-right">{item.quantity}</div>
                                                            <div className="tabular-nums md:text-right">{PKR(Number(item.rate) || 0)}</div>
                                                            <div className="font-semibold tabular-nums md:text-right">{PKR(Number(item.amount) || 0)}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <p className="text-xs text-muted-foreground">
                                                These booked-order values are preloaded into the invoice editor below so you can review before saving.
                                            </p>
                                        </div>
                                    </Section>
                                )}

                                <Section
                                    icon={AlertCircle}
                                    title="Invoice Items"
                                    subtitle="Products being sold in this invoice"
                                    step={3}
                                    action={!activeWarehouse ? <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertCircle className="size-3" /> Select a warehouse first</p> : null}
                                >
                                    <InvoiceItemsSection
                                        form={form}
                                        items={items}
                                        availableStock={availableStock}
                                        activeWarehouse={activeWarehouse}
                                        totalAmount={totalAmount}
                                        getCartonInfo={getCartonInfo}
                                        handleFocus={handleFocus}
                                        recipePriceMap={recipePriceMapWithEntityRates}
                                        discountRuleMap={discountRuleMap}
                                        isDistributor={isDistributorInvoice}
                                        preserveOrderLineRate={isOrderConversionContext}
                                        customerDefaultMargin={selectedCustomerDefaultMargin}
                                    />
                                </Section>

                                <SettlementSection
                                    form={form}
                                    totalAmount={totalAmount}
                                    totalProfit={totalProfit}
                                    expenses={expenses}
                                    isRetailerInvoice={isRetailerInvoice}
                                    invoiceDiscount={appliedDiscount}
                                    totalPayable={totalPayable}
                                    cashPaid={cashPaid}
                                    totalCredit={totalCredit}
                                    cashExceedsTotal={cashExceedsTotal}
                                    isFullyPaid={isFullyPaid}
                                    handleFocus={handleFocus}
                                />
                            </div>
                        );
                    }}
                </form.Subscribe>

                <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
                    {([canSubmit, isSubmitting]: any) => (
                        <div className="sticky bottom-0 bg-background/90 backdrop-blur-md border-t px-4 py-3 -mx-1 rounded-b-xl">
                            {!canSubmit && !isSubmitting && (
                                <div className="mb-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg">
                                    <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
                                        <AlertCircle className="size-3.5 shrink-0" />
                                        Please fix validation errors above before generating the invoice.
                                    </p>
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-3 max-w-full">
                                <p className="text-xs text-muted-foreground hidden sm:block">Please verify all entries before generating the invoice.</p>
                                <div className="flex gap-2.5 ml-auto">
                                    <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={isPending} className="min-w-24">
                                        Cancel
                                    </Button>
                                    <Button type="submit" size="lg" disabled={isPending} className="min-w-40 gap-2 font-bold">
                                        {isPending ? <><Loader2 className="size-4 animate-spin" /> Processing…</> : <><ChevronRight className="size-4" /> Generate Invoice</>}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </form.Subscribe>
            </FieldGroup>
        </form>
    );
};

function computeTotal(
    items: ItemFormValue[],
    availableStock: StockItem[],
    pricingMode: "retailer" | "distributor" = "retailer",
    discountRuleMap?: Map<string, any[]>,
    marginPercent = 0,
): number {
    return roundMoney(items.reduce((acc, item) => {
        const stock = findStock(availableStock, item.recipeId);
        const recipeDefault = stock?.recipe?.containersPerCarton || 1;
        const autoFreeCartons = getAutoDiscountCartons(item, discountRuleMap);
        return acc + getLinePricingBreakdown(
            item,
            recipeDefault,
            undefined,
            pricingMode,
            autoFreeCartons,
            marginPercent,
        ).netAmount;
    }, 0));
}

function computeProfit(
    items: ItemFormValue[],
    availableStock: StockItem[],
    recipePriceMap: Map<string, RecipePriceEntry>,
    pricingMode: "retailer" | "distributor" = "retailer",
    discountRuleMap?: Map<string, any[]>,
    marginPercent = 0,
): number {
    return roundMoney(items.reduce((acc, item) => {
        const stock = findStock(availableStock, item.recipeId);
        const recipeDefault = Number(stock?.recipe?.containersPerCarton || item.packsPerCarton || 1);
        const recipePricing = recipePriceMap.get(item.recipeId);
        const unitCostPerPack = getLineUnitCostPerPack(item, stock, recipePricing, pricingMode);
        const autoFreeCartons = getAutoDiscountCartons(item, discountRuleMap);
        return acc + getLinePricingBreakdown(
            item,
            recipeDefault,
            unitCostPerPack,
            pricingMode,
            autoFreeCartons,
            marginPercent,
        ).profit;
    }, 0));
}

function getAutoDiscountCartons(
    item: ItemFormValue,
    discountRuleMap?: Map<string, any[]>,
): number {
    if (item.unitType !== "carton" || !item.recipeId || !discountRuleMap) {
        return 0;
    }

    return getApplicableDistributorFreeCartons({
        rules: discountRuleMap.get(item.recipeId) ?? [],
        recipeId: item.recipeId,
        numberOfCartons: item.numberOfCartons || 0,
        manualFreeCartons: item.discountCartons || 0,
    }).freeCartons;
}
