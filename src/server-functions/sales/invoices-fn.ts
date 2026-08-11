import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import { invoices, invoiceItems, customers } from "@/db/schemas/sales-schema";
import {
  payments,
  slipRecords,
  discountRules,
  priceChangeLog,
  entityRecipeRates,
  salesReturns,
} from "@/db/schemas/sales-erp-schema";
import { finishedGoodsStock, warehouses } from "@/db/schemas/inventory-schema";
import { cartons } from "@/db/schemas/manufacturing-schema";
import { AppError } from "@/lib/errors";
import { GENERAL_RECIPE_RATE_ENTITY_ID } from "@/lib/sales/entity-recipe-rate-config";
import { getApplicableDistributorFreeCartons } from "@/lib/sales/distributor-discount-rules";
import { effectiveCPP } from "@/lib/sales/effective-cpp";
import {
  calculateInvoiceLinePricing,
  type InvoicePricingMode,
} from "@/lib/sales/invoice-line-pricing";
import { calculateTotalUnits, calculateTotalInventoryValue } from "@/lib/wac";
import { postInvoice } from "./invoice-posting-service";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";
import { recalculateInvoiceSettlement } from "./settlement-service";
import {
  assertSettlementDueDate,
  calculateSettlement,
} from "@/lib/sales/settlement/math";
import {
  requireSalesManageMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import {
  count,
  sql,
  eq,
  and,
  gte,
  lte,
  like,
  SQL,
  desc as drizzleDesc,
  asc as drizzleAsc,
  sum,
  gt,
  or,
  isNull,
  inArray,
  notInArray,
} from "drizzle-orm";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  type CreateInvoiceInput,
} from "@/db/zod_schemas";
import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  parseISO,
  isValid,
  endOfDay,
} from "date-fns";

// ── Shared sort config ─────────────────────────────────────────────────────
const sortFields = {
  date: invoices.date,
  totalPrice: invoices.totalPrice,
  outstandingAmount: invoices.outstandingAmount,
  createdAt: invoices.createdAt,
} as const;

// ── Helper: build invoice status conditions ────────────────────────────────
const buildStatusCondition = (status: string): SQL | undefined => {
  // Use sql`` casts for numeric comparison on decimal columns (avoids "0" vs "0.00" mismatch)
  if (status === "paid") return eq(invoices.paymentStatus, "paid");
  if (status === "outstanding") {
    return and(
      eq(invoices.paymentStatus, "unpaid"),
      sql`${invoices.outstandingAmount} > 0`,
    );
  }
  if (status === "partial") return eq(invoices.paymentStatus, "partially_paid");
  return undefined;
};

const roundMoney = (value: number) => Number(value.toFixed(2));

const formatMoney = (value: number) => `PKR ${roundMoney(value).toFixed(2)}`;

const getInvoicePricingMode = (
  customerType: string | null | undefined,
): InvoicePricingMode =>
  customerType === "distributor" ? "distributor" : "retailer";

const resolveFactoryFloorWarehouse = async (tx: any) => {
  const factoryFloorWarehouse = await tx.query.warehouses.findFirst({
    where: eq(warehouses.type, "factory_floor"),
    columns: { id: true, name: true },
  });

  if (!factoryFloorWarehouse) {
    throw new Error(
      "Factory floor warehouse not found. Create a warehouse with type 'factory_floor' first.",
    );
  }

  return factoryFloorWarehouse;
};

const assertInvoiceMutationAllowed = async ({
  tx,
  invoiceId,
  action,
}: {
  tx: any;
  invoiceId: string;
  action: "update" | "delete";
}) => {
  const invoice = await tx.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    columns: { source: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.source === "offline_import") {
    throw new AppError(
      "Offline invoices cannot be edited or deleted here.",
      "OFFLINE_INVOICE_IMMUTABLE",
      400,
    );
  }

  const relatedPayments = await tx.query.payments.findMany({
    where: eq(payments.invoiceId, invoiceId),
    columns: {
      id: true,
      status: true,
    },
  });

  if (
    action === "delete" &&
    relatedPayments.some(
      (payment: { status: string }) => payment.status === "confirmed",
    )
  ) {
    throw new AppError(
      "Reverse confirmed payments before deleting this invoice.",
      "INVOICE_HAS_CONFIRMED_PAYMENTS",
      400,
    );
  }
  if (
    action === "delete" &&
    relatedPayments.some(
      (payment: { status: string }) => payment.status === "pending",
    )
  ) {
    throw new AppError(
      "Cancel or return pending payments before deleting this invoice.",
      "INVOICE_HAS_PENDING_PAYMENTS",
      400,
    );
  }

  const [returnAgg] = await tx
    .select({ count: count() })
    .from(salesReturns)
    .where(eq(salesReturns.invoiceId, invoiceId));

  if (Number(returnAgg?.count) > 0) {
    throw new AppError(
      `Cannot ${action} an invoice that already has sales return activity recorded.`,
      "INVOICE_HAS_SALES_RETURNS",
      400,
    );
  }
};

const OPERATIONAL_CARTON_STATUSES = [
  "PARTIAL",
  "COMPLETE",
  "SEALED",
  "ON_HOLD",
] as const;

const UNSALEABLE_CARTON_STATUSES = [
  "RETIRED",
  "DISPATCHED",
  "ARCHIVED",
  "ON_HOLD",
  "SEALED",
] as const;

type CartonInventorySnapshot = {
  physicalTotalCartons: number;
  physicalTotalPacks: number;
  sellableCompleteCartons: number;
  sellableTotalPacks: number;
};

const getCartonInventorySnapshot = async ({
  tx,
  warehouseId,
  recipeId,
}: {
  tx: any;
  warehouseId: string;
  recipeId: string;
}): Promise<CartonInventorySnapshot> => {
  const [physicalRow] = await tx
    .select({
      physicalTotalCartons: sql<number>`COALESCE(COUNT(*), 0)::int`,
      physicalTotalPacks: sql<number>`COALESCE(SUM(${cartons.currentPacks}), 0)::int`,
    })
    .from(cartons)
    .where(
      and(
        eq(cartons.warehouseId, warehouseId),
        eq(cartons.recipeId, recipeId),
        inArray(
          cartons.status,
          OPERATIONAL_CARTON_STATUSES as unknown as string[],
        ),
      ),
    );

  const [sellableRow] = await tx
    .select({
      sellableCompleteCartons: sql<number>`COALESCE(SUM(CASE WHEN ${cartons.status} = 'COMPLETE' THEN 1 ELSE 0 END), 0)::int`,
      sellableTotalPacks: sql<number>`COALESCE(SUM(${cartons.currentPacks}), 0)::int`,
    })
    .from(cartons)
    .where(
      and(
        eq(cartons.warehouseId, warehouseId),
        eq(cartons.recipeId, recipeId),
        notInArray(
          cartons.status,
          UNSALEABLE_CARTON_STATUSES as unknown as string[],
        ),
      ),
    );

  return {
    physicalTotalCartons: Number(physicalRow?.physicalTotalCartons ?? 0),
    physicalTotalPacks: Number(physicalRow?.physicalTotalPacks ?? 0),
    sellableCompleteCartons: Number(sellableRow?.sellableCompleteCartons ?? 0),
    sellableTotalPacks: Number(sellableRow?.sellableTotalPacks ?? 0),
  };
};

const buildFinishedGoodsAvailability = ({
  stock,
  containersPerCarton,
  cartonSnapshot,
}: {
  stock: any;
  containersPerCarton: number;
  cartonSnapshot: CartonInventorySnapshot | null;
}) => {
  const looseUnits = Number(stock.quantityContainers ?? 0);
  const hasManagedCartons =
    stock.recipe?.cartonPackagingId != null && containersPerCarton > 0;

  if (!hasManagedCartons || !cartonSnapshot) {
    const totalUnits =
      Number(stock.quantityCartons ?? 0) * containersPerCarton + looseUnits;

    return {
      physicalTotalUnits: totalUnits,
      sellableTotalUnits: totalUnits,
      sellableCompleteCartons: Number(stock.quantityCartons ?? 0),
    };
  }

  return {
    physicalTotalUnits: cartonSnapshot.physicalTotalPacks + looseUnits,
    sellableTotalUnits: cartonSnapshot.sellableTotalPacks + looseUnits,
    sellableCompleteCartons: cartonSnapshot.sellableCompleteCartons,
  };
};

const resolveStockUnitCostPerPack = ({
  weightedAverageCostPerPack,
  configuredPricePerPack,
  estimatedCostPerContainer,
  fallbackPerCartonPrice,
  containersPerCarton,
}: {
  weightedAverageCostPerPack?: string | number | null;
  configuredPricePerPack?: number | null;
  estimatedCostPerContainer?: string | number | null;
  fallbackPerCartonPrice: number;
  containersPerCarton: number;
}): number => {
  const weightedAverageCost = Number(weightedAverageCostPerPack ?? 0);
  if (weightedAverageCost > 0) return weightedAverageCost;

  const configuredPrice = Number(configuredPricePerPack ?? 0);
  if (configuredPrice > 0) return configuredPrice;

  const estimatedCost = Number(estimatedCostPerContainer ?? 0);
  if (estimatedCost > 0) return estimatedCost;

  return containersPerCarton > 0
    ? fallbackPerCartonPrice / containersPerCarton
    : 0;
};

const resolveConfiguredBaseCartonRate = ({
  configuredPricePerPack,
  itemPerCartonPrice,
  containersPerCarton,
  preferConfiguredRate = false,
}: {
  configuredPricePerPack?: number | null;
  itemPerCartonPrice?: number | null;
  containersPerCarton: number;
  preferConfiguredRate?: boolean;
}): number => {
  const configuredRatePerPack = Number(configuredPricePerPack ?? 0);
  const configuredCartonRate =
    configuredRatePerPack > 0
      ? roundMoney(configuredRatePerPack * containersPerCarton)
      : 0;

  if (preferConfiguredRate && configuredCartonRate > 0) {
    return configuredCartonRate;
  }

  const itemRate = Number(itemPerCartonPrice ?? 0);
  if (itemRate > 0) return roundMoney(itemRate);

  return configuredCartonRate;
};

const normalizeText = (value: string | null | undefined) =>
  (value ?? "").trim();

const formatDateValue = (value: Date | string | null | undefined) => {
  if (!value) return "none";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
};

const buildInvoiceItemSignature = (
  items: Array<{
    recipeId?: string | null;
    pack?: string | null;
    numberOfCartons?: number | string | null;
    quantity?: number | string | null;
    numberOfUnits?: number | string | null;
    discountCartons?: number | string | null;
    perCartonPrice?: number | string | null;
    retailPrice?: number | string | null;
  }>,
) =>
  items
    .map((item) =>
      [
        item.recipeId ?? "",
        item.pack ?? "",
        Number(item.numberOfCartons ?? 0),
        Number(item.quantity ?? item.numberOfUnits ?? 0),
        Number(item.discountCartons ?? 0),
        Number(item.perCartonPrice ?? 0).toFixed(2),
        Number(item.retailPrice ?? 0).toFixed(2),
      ].join(":"),
    )
    .sort()
    .join("|");

const calculateLineWeightKg = (
  dispatchedUnits: number,
  fillAmount: string | number | null | undefined,
  fillUnit: string | null | undefined,
) => {
  const normalizedFillAmount = Number(fillAmount ?? 0);
  if (!(normalizedFillAmount > 0) || dispatchedUnits <= 0) return 0;

  if (fillUnit === "g" || fillUnit === "ml") {
    return dispatchedUnits * (normalizedFillAmount / 1000);
  }

  if (fillUnit === "kg") {
    return dispatchedUnits * normalizedFillAmount;
  }

  return 0;
};

const getSavedInvoiceItemDispatchedUnits = (
  item: {
    dispatchedUnits?: number | string | null;
    numberOfCartons?: number | string | null;
    discountCartons?: number | string | null;
    freeCartons?: number | string | null;
    quantity?: number | string | null;
  },
  containersPerCarton: number,
) => {
  const savedDispatchedUnits = Number(item.dispatchedUnits ?? 0);
  if (savedDispatchedUnits > 0) {
    return savedDispatchedUnits;
  }

  const restoredCartons =
    Number(item.numberOfCartons ?? 0) +
    Number(item.discountCartons ?? 0) +
    Number(item.freeCartons ?? 0);

  return restoredCartons * containersPerCarton + Number(item.quantity ?? 0);
};

type InvoiceMutationItem = CreateInvoiceInput["items"][number];

type InvoiceLineResolution = {
  item: InvoiceMutationItem;
  stock: any;
  containersPerCarton: number;
  chargedUnits: number;
  requestedUnits: number;
  discountUnits: number;
  manualDiscountCartons: number;
  discountFreeCartons: number;
  totalDispatchedUnits: number;
  baseCartonRate: number;
  unitCostPerPack: number;
  cogsPerUnit: number;
  cogsTotal: number;
  tpPrice: number | null;
  marginPercent: number | null;
  discountRuleId: string | null;
  lineAmount: number;
  pricingBreakdown: ReturnType<typeof calculateInvoiceLinePricing>;
  lineWeightKg: number;
  fillAmountSnapshot: number;
  fillUnitSnapshot: string | null;
  productId: string | null;
  unitMargin: number;
  sourceBaseCartonRate: number;
};

const buildConfiguredRecipePriceMap = async ({
  tx,
  customerType,
  customerId,
  orderBookerId,
}: {
  tx: any;
  customerType: string | null | undefined;
  customerId: string;
  orderBookerId?: string | null;
}) => {
  const [allRecipePrices, allRecipes, scopedEntityRates] = await Promise.all([
    tx.query.recipePrices.findMany(),
    tx.query.recipes.findMany({
      columns: { id: true, containersPerCarton: true },
    }),
    customerType === "distributor"
      ? tx.query.entityRecipeRates.findMany({
          where: and(
            eq(entityRecipeRates.entityType, "distributor"),
            eq(entityRecipeRates.entityId, customerId),
          ),
        })
      : tx.query.entityRecipeRates.findMany({
          where: orderBookerId
            ? or(
                and(
                  eq(entityRecipeRates.entityType, "general"),
                  eq(entityRecipeRates.entityId, GENERAL_RECIPE_RATE_ENTITY_ID),
                ),
                and(
                  eq(entityRecipeRates.entityType, "order_booker"),
                  eq(entityRecipeRates.entityId, orderBookerId),
                ),
              )
            : and(
                eq(entityRecipeRates.entityType, "general"),
                eq(entityRecipeRates.entityId, GENERAL_RECIPE_RATE_ENTITY_ID),
              ),
        }),
  ]);

  const recipePriceMap = new Map(
    (allRecipePrices as any[]).map((rp: any) => [
      rp.recipeId,
      Number(rp.invoicePricePerPack),
    ]),
  );
  const recipeContainersMap = new Map(
    (allRecipes as any[]).map((recipe: any) => [
      recipe.id,
      Number(recipe.containersPerCarton ?? 0),
    ]),
  );
  const applyEntityRate = (rate: any) => {
    const containersPerCarton = recipeContainersMap.get(rate.recipeId) ?? 0;
    if (containersPerCarton <= 0) return;
    recipePriceMap.set(
      rate.recipeId,
      roundMoney(Number(rate.pricePerCarton) / containersPerCarton),
    );
  };

  if (customerType === "distributor") {
    for (const rate of scopedEntityRates) {
      applyEntityRate(rate);
    }
    return recipePriceMap;
  }

  const generalRates = scopedEntityRates.filter(
    (rate: any) => rate.entityType === "general",
  );
  const orderBookerRates = scopedEntityRates.filter(
    (rate: any) => rate.entityType === "order_booker",
  );

  const applyEntityRates = (rates: any[]) => {
    for (const rate of rates) {
      applyEntityRate(rate);
    }
  };

  applyEntityRates(generalRates);
  applyEntityRates(orderBookerRates);

  return recipePriceMap;
};

const resolveCanonicalInvoiceLine = ({
  item,
  stock,
  containersPerCarton,
  pricingMode,
  configuredPricePerPack,
  customerDefaultMargin,
  manualDiscountCartons,
  autoFreeCartons,
  discountRuleId,
  preferConfiguredRate,
}: {
  item: InvoiceMutationItem;
  stock: any;
  containersPerCarton: number;
  pricingMode: InvoicePricingMode;
  configuredPricePerPack?: number | null;
  customerDefaultMargin?: number | null;
  manualDiscountCartons: number;
  autoFreeCartons: number;
  discountRuleId: string | null;
  preferConfiguredRate?: boolean;
}): InvoiceLineResolution => {
  const baseCartonRate = resolveConfiguredBaseCartonRate({
    configuredPricePerPack,
    itemPerCartonPrice: item.perCartonPrice,
    containersPerCarton,
    preferConfiguredRate,
  });

  const unitCostPerPack = resolveStockUnitCostPerPack({
    weightedAverageCostPerPack: stock.weightedAverageCostPerPack,
    configuredPricePerPack,
    estimatedCostPerContainer: stock.recipe.estimatedCostPerContainer,
    fallbackPerCartonPrice: baseCartonRate || item.perCartonPrice,
    containersPerCarton,
  });

  const appliedMarginPercent =
    pricingMode === "distributor" && !item.preserveStoredDistributorRate
      ? Number(customerDefaultMargin ?? 0)
      : 0;

  const pricingBreakdown = calculateInvoiceLinePricing({
    invoiceMode: pricingMode === "distributor" ? "distributor" : "general",
    unitType: item.unitType,
    numberOfCartons: item.numberOfCartons,
    numberOfUnits: item.numberOfUnits,
    manualFreeCartons: manualDiscountCartons,
    autoFreeCartons,
    baseCartonRate,
    containersPerCarton,
    defaultMarginPercent: appliedMarginPercent,
    unitCostPerPack,
  });

  const wacPerPack = parseFloat(
    stock.weightedAverageCostPerPack?.toString() || "0",
  );
  const cogsPerUnit = wacPerPack > 0 ? wacPerPack : unitCostPerPack;
  const cogsTotal = roundMoney(pricingBreakdown.dispatchedUnits * cogsPerUnit);
  const revenuePerUnit =
    pricingBreakdown.chargedUnits > 0
      ? pricingBreakdown.netAmount / pricingBreakdown.chargedUnits
      : 0;
  const unitMargin = roundMoney(revenuePerUnit - cogsPerUnit);
  const fillAmountSnapshot = Number(stock.recipe.fillAmount ?? 0);
  const fillUnitSnapshot = stock.recipe.fillUnit
    ? String(stock.recipe.fillUnit)
    : null;
  const lineWeightKg = calculateLineWeightKg(
    pricingBreakdown.dispatchedUnits,
    fillAmountSnapshot,
    fillUnitSnapshot,
  );

  return {
    item,
    stock,
    containersPerCarton,
    chargedUnits: pricingBreakdown.chargedUnits,
    requestedUnits: pricingBreakdown.dispatchedUnits,
    discountUnits:
      (manualDiscountCartons + autoFreeCartons) * containersPerCarton,
    manualDiscountCartons,
    discountFreeCartons: autoFreeCartons,
    totalDispatchedUnits: pricingBreakdown.dispatchedUnits,
    baseCartonRate: pricingBreakdown.baseCartonRate,
    unitCostPerPack,
    cogsPerUnit,
    cogsTotal,
    tpPrice: null,
    marginPercent: appliedMarginPercent > 0 ? appliedMarginPercent : null,
    discountRuleId,
    lineAmount: pricingBreakdown.netAmount,
    pricingBreakdown,
    lineWeightKg,
    fillAmountSnapshot,
    fillUnitSnapshot,
    productId: stock.recipe.productId,
    unitMargin,
    sourceBaseCartonRate: Number(item.perCartonPrice || 0),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// GET INVOICES (extended with advanced filters)
// ═══════════════════════════════════════════════════════════════════════════
export const getInvoicesFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().default(10),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        month: z.number().min(0).max(11).nullable().optional(),
        year: z.number().optional(),
        status: z.enum(["paid", "outstanding", "partial"]).optional(),
        customerType: z.enum(["distributor", "retailer"]).optional(),
        warehouseId: z.string().optional(),
        amountMin: z.number().min(0).optional(),
        amountMax: z.number().min(0).optional(),
        search: z.string().optional(),
        sortBy: z
          .enum(["date", "totalPrice", "outstandingAmount", "createdAt"])
          .default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const offset = (data.page - 1) * data.limit;
    const conditions: SQL[] = [];

    // Date range filters
    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(invoices.date, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(invoices.date, endOfDay(to)));
    }

    // Month/year filters
    if (data.month != null && data.year !== undefined) {
      const targetDate = new Date(data.year, data.month, 1);
      conditions.push(gte(invoices.date, startOfMonth(targetDate)));
      conditions.push(lte(invoices.date, endOfMonth(targetDate)));
    } else if (data.year !== undefined) {
      const targetDate = new Date(data.year, 0, 1);
      conditions.push(gte(invoices.date, startOfYear(targetDate)));
      conditions.push(lte(invoices.date, endOfYear(targetDate)));
    }

    // Status filter
    const statusCondition = buildStatusCondition(data.status ?? "");
    if (statusCondition) conditions.push(statusCondition);

    // Customer type filter (requires join)
    if (data.customerType) {
      conditions.push(eq(customers.customerType, data.customerType));
    }

    // Warehouse filter
    if (data.warehouseId) {
      conditions.push(eq(invoices.warehouseId, data.warehouseId));
    }

    // Amount range filters
    if (data.amountMin !== undefined) {
      conditions.push(gte(invoices.totalPrice, data.amountMin.toString()));
    }
    if (data.amountMax !== undefined) {
      conditions.push(lte(invoices.totalPrice, data.amountMax.toString()));
    }

    // Slip number search filter
    if (data.search) {
      const safeSearch = data.search.replace(/[%_]/g, "");
      if (safeSearch) {
        conditions.push(like(invoices.invoiceNumber, `%${safeSearch}%`));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ value: count() })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause);

    const sortColumn = sortFields[data.sortBy] ?? invoices.createdAt;

    const dataQuery = await db.query.invoices.findMany({
      where: whereClause,
      with: { customer: true, warehouse: true },
      limit: data.limit,
      offset,
      orderBy:
        data.sortOrder === "asc"
          ? [drizzleAsc(sortColumn)]
          : [drizzleDesc(sortColumn)],
    });

    return {
      data: dataQuery,
      total: Number(totalResult.value),
      pageCount: Math.ceil(Number(totalResult.value) / data.limit),
    };
  });

export const createInvoiceFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: unknown) => createInvoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");

    return db.transaction((tx) =>
      postInvoice(tx, {
        ...data,
        performedById: context.session.user.id,
        source: "online",
        businessDate: new Date(),
        stockPolicy: "strict",
        creditPolicy: "block",
        pricingPolicy: "live",
      }),
    );
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET INVOICE DETAIL (single invoice with items, customer, warehouse)
// ═══════════════════════════════════════════════════════════════════════════
export const getInvoiceDetailFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, data.id),
      with: {
        customer: true,
        warehouse: true,
        items: true,
        performer: { columns: { id: true, name: true, email: true } },
      },
    });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    return invoice;
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET INVOICE STATS (KPI aggregates, accepts same filters as list)
// ═══════════════════════════════════════════════════════════════════════════
export const getInvoiceStatsFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        status: z.enum(["paid", "outstanding", "partial"]).optional(),
        customerType: z.enum(["distributor", "retailer"]).optional(),
        warehouseId: z.string().optional(),
        amountMin: z.number().min(0).optional(),
        amountMax: z.number().min(0).optional(),
      })
      .passthrough()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const conditions: SQL[] = [];

    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(invoices.date, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(invoices.date, endOfDay(to)));
    }

    const statusCondition = buildStatusCondition(data.status ?? "");
    if (statusCondition) conditions.push(statusCondition);

    if (data.customerType) {
      conditions.push(eq(customers.customerType, data.customerType));
    }

    if (data.warehouseId) {
      conditions.push(eq(invoices.warehouseId, data.warehouseId));
    }

    if (data.amountMin !== undefined) {
      conditions.push(gte(invoices.totalPrice, data.amountMin.toString()));
    }
    if (data.amountMax !== undefined) {
      conditions.push(lte(invoices.totalPrice, data.amountMax.toString()));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total invoices count
    const [countResult] = await db
      .select({ value: count() })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause);

    // Total revenue
    const [revenueResult] = await db
      .select({ value: sum(invoices.totalPrice) })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(whereClause);

    // Total Outstanding Amount
    const outstandingConditions = [
      ...conditions,
      gt(invoices.outstandingAmount, "0"),
    ];
    const outstandingWhere =
      outstandingConditions.length > 0
        ? and(...outstandingConditions)
        : undefined;

    const [outstandingResult] = await db
      .select({ value: sum(invoices.outstandingAmount) })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(outstandingWhere);

    // Average invoice value
    const avgValue =
      countResult.value > 0
        ? Number(revenueResult.value ?? 0) / Number(countResult.value)
        : 0;

    return {
      totalInvoices: Number(countResult.value) || 0,
      totalRevenue: Number(revenueResult.value) || 0,
      totalOutstanding: Number(outstandingResult.value) || 0,
      monthRevenue: Number(revenueResult.value) || 0, // same as totalRevenue when filtered
      averageInvoiceValue: avgValue,
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// DELETE INVOICE (with ledger + stock rollback)
// ═══════════════════════════════════════════════════════════════════════════
export const deleteInvoiceFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");

    return await db.transaction(async (tx) => {
      const invoice = await tx.query.invoices.findFirst({
        where: eq(invoices.id, data.id),
        with: { items: true, customer: true },
      });

      if (!invoice) {
        throw new Error("Invoice not found");
      }

      await assertInvoiceMutationAllowed({
        tx,
        invoiceId: invoice.id,
        action: "delete",
      });

      // Reverse customer ledger
      await tx
        .update(customers)
        .set({
          totalSale: sql`${customers.totalSale} - ${invoice.amount}`,
          outstandingAmount: sql`${customers.outstandingAmount} - ${invoice.outstandingAmount}`,
          weightSaleKg: sql`${customers.weightSaleKg} - ${invoice.items.reduce((acc, item) => acc + Number(item.totalWeight), 0)}`,
          expenses: sql`${customers.expenses} - ${invoice.expenses}`,
        })
        .where(eq(customers.id, invoice.customerId));

      // Restore stock
      for (const item of invoice.items) {
        if (!item.recipeId) continue;
        const stockWarehouseId =
          invoice.stockWarehouseId ?? invoice.warehouseId;

        const stock = await tx.query.finishedGoodsStock.findFirst({
          where: and(
            eq(finishedGoodsStock.warehouseId, stockWarehouseId),
            eq(finishedGoodsStock.recipeId, item.recipeId),
          ),
          with: { recipe: true },
        });

        if (!stock) continue;

        const containersPerCarton = effectiveCPP(
          stock.recipe.containersPerCarton ?? 0,
        );
        const totalUnitsToRestore = getSavedInvoiceItemDispatchedUnits(
          item,
          containersPerCarton,
        );
        const cartonSnapshot =
          stock.recipe?.cartonPackagingId != null && containersPerCarton > 0
            ? await getCartonInventorySnapshot({
                tx,
                warehouseId: stockWarehouseId,
                recipeId: item.recipeId,
              })
            : null;
        const currentUnits = buildFinishedGoodsAvailability({
          stock,
          containersPerCarton,
          cartonSnapshot,
        }).physicalTotalUnits;
        const newUnits = currentUnits + totalUnitsToRestore;

        const hasCartons =
          stock.recipe.cartonPackagingId != null &&
          stock.recipe.containersPerCarton != null &&
          stock.recipe.containersPerCarton > 0;
        const finalQuantityCartons = hasCartons
          ? Math.floor(newUnits / containersPerCarton)
          : 0;
        const finalQuantityContainers = hasCartons
          ? newUnits % containersPerCarton
          : newUnits;

        const wacPerPack = parseFloat(
          stock.weightedAverageCostPerPack?.toString() || "0",
        );
        const totalUnits = calculateTotalUnits(
          finalQuantityCartons,
          finalQuantityContainers,
          containersPerCarton,
        );
        const newTotalValue = calculateTotalInventoryValue(
          totalUnits,
          wacPerPack,
        );

        await tx
          .update(finishedGoodsStock)
          .set({
            quantityCartons: finalQuantityCartons,
            quantityContainers: finalQuantityContainers,
            totalInventoryValue: newTotalValue.toFixed(2),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(finishedGoodsStock.warehouseId, stockWarehouseId),
              eq(finishedGoodsStock.recipeId, item.recipeId),
            ),
          );
      }

      // Delete related records, then invoice (no cascades on payments/slips)
      await tx
        .delete(priceChangeLog)
        .where(eq(priceChangeLog.invoiceId, data.id));
      await tx.delete(payments).where(eq(payments.invoiceId, data.id));
      await tx.delete(slipRecords).where(eq(slipRecords.invoiceId, data.id));
      await tx.delete(invoices).where(eq(invoices.id, data.id));

      return { success: true, id: data.id };
    });
  });
// ═══════════════════════════════════════════════════════════════════════════
// UPDATE INVOICE
// ═══════════════════════════════════════════════════════════════════════════
export const updateInvoiceFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => updateInvoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      // 1. Fetch existing invoice
      const existing = await tx.query.invoices.findFirst({
        where: eq(invoices.id, data.id),
        with: { items: true },
      });

      if (!existing) throw new Error("Invoice not found");

      await assertInvoiceMutationAllowed({
        tx,
        invoiceId: existing.id,
        action: "update",
      });

      const customerId = existing.customerId;

      // 2. Reverse OLD changes

      // Reverse Stock
      for (const oldItem of existing.items) {
        if (!oldItem.recipeId) continue;
        const oldStockWarehouseId =
          existing.stockWarehouseId ?? existing.warehouseId;

        const stock = await tx.query.finishedGoodsStock.findFirst({
          where: and(
            eq(finishedGoodsStock.warehouseId, oldStockWarehouseId),
            eq(finishedGoodsStock.recipeId, oldItem.recipeId),
          ),
          with: { recipe: true },
        });

        if (!stock) continue;

        const cpp = oldItem.actualPackSize ?? 1;
        const oldUnits = getSavedInvoiceItemDispatchedUnits(oldItem, cpp);

        const cartonSnapshot =
          stock.recipe?.cartonPackagingId != null && cpp > 0
            ? await getCartonInventorySnapshot({
                tx,
                warehouseId: oldStockWarehouseId,
                recipeId: oldItem.recipeId,
              })
            : null;
        const currentUnits = buildFinishedGoodsAvailability({
          stock,
          containersPerCarton: cpp,
          cartonSnapshot,
        }).physicalTotalUnits;
        const restoredUnits = currentUnits + oldUnits;

        const hasCartons =
          stock.recipe.cartonPackagingId != null &&
          stock.recipe.containersPerCarton != null &&
          stock.recipe.containersPerCarton > 0;
        const finalQuantityCartons = hasCartons
          ? Math.floor(restoredUnits / cpp)
          : 0;
        const finalQuantityContainers = hasCartons
          ? restoredUnits % cpp
          : restoredUnits;

        const wacPerPack = parseFloat(
          stock.weightedAverageCostPerPack?.toString() || "0",
        );
        const totalUnits = calculateTotalUnits(
          finalQuantityCartons,
          finalQuantityContainers,
          cpp,
        );
        const newTotalValue = calculateTotalInventoryValue(
          totalUnits,
          wacPerPack,
        );

        await tx
          .update(finishedGoodsStock)
          .set({
            quantityCartons: finalQuantityCartons,
            quantityContainers: finalQuantityContainers,
            totalInventoryValue: newTotalValue.toFixed(2),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(finishedGoodsStock.warehouseId, oldStockWarehouseId),
              eq(finishedGoodsStock.recipeId, oldItem.recipeId),
            ),
          );
      }

      // Reverse Ledger/Customer Stats
      const oldTotalWeight = existing.items.reduce(
        (acc, it) => acc + Number(it.totalWeight),
        0,
      );
      await tx
        .update(customers)
        .set({
          totalSale: sql`${customers.totalSale} - ${Number(existing.amount)}`,
          weightSaleKg: sql`${customers.weightSaleKg} - ${oldTotalWeight}`,
          expenses: sql`${customers.expenses} - ${Number(existing.expenses)}`,
        })
        .where(eq(customers.id, customerId));

      // Delete OLD items
      await tx
        .delete(invoiceItems)
        .where(eq(invoiceItems.invoiceId, existing.id));

      // 3. Apply NEW changes (Re-use logic from createInvoiceFn)

      // Fetch customer for default margin
      const customerRecordUpdate = await tx.query.customers.findFirst({
        where: eq(customers.id, customerId),
        columns: { defaultMargin: true, customerType: true },
      });
      const customerDefaultMarginUpdate = customerRecordUpdate?.defaultMargin
        ? Number(customerRecordUpdate.defaultMargin)
        : null;
      const isRetailerInvoice =
        customerRecordUpdate?.customerType === "retailer";
      const pricingMode = getInvoicePricingMode(
        customerRecordUpdate?.customerType,
      );
      const factoryFloorWarehouse = await resolveFactoryFloorWarehouse(tx);
      const stockWarehouseId = factoryFloorWarehouse.id;

      // Fetch distributor-only active free-unit rules + server-authoritative recipe rates
      const [distributorDiscountRules, recipePriceMap] = await Promise.all([
        tx.query.discountRules.findMany({
          where: and(
            eq(discountRules.customerId, customerId),
            eq(discountRules.ruleType, "free_units"),
            eq(discountRules.isActive, true),
            lte(discountRules.effectiveFrom, new Date()),
            or(
              isNull(discountRules.effectiveTo),
              gte(discountRules.effectiveTo, new Date()),
            ),
          ),
        }),
        buildConfiguredRecipePriceMap({
          tx,
          customerType: customerRecordUpdate?.customerType,
          customerId,
          orderBookerId: existing.orderBookerId,
        }),
      ]);

      // Cache discount rules by recipeId for fast lookup
      const discountRulesByRecipe = new Map<
        string,
        typeof distributorDiscountRules
      >();
      for (const rule of distributorDiscountRules) {
        if (!rule.recipeId) continue;
        if (!discountRulesByRecipe.has(rule.recipeId)) {
          discountRulesByRecipe.set(rule.recipeId, []);
        }
        discountRulesByRecipe.get(rule.recipeId)!.push(rule);
      }

      const lineResolutions: InvoiceLineResolution[] = [];
      let totalAmount = 0;
      let totalWeightKg = 0;
      const reservedUnitsByRecipe = new Map<string, number>();
      const reservedCartonsByRecipe = new Map<string, number>();
      const physicalAvailableUnitsByRecipe = new Map<string, number>();
      const cartonSnapshotByRecipe = new Map<string, CartonInventorySnapshot>();

      for (const item of data.items) {
        const stock = await tx.query.finishedGoodsStock.findFirst({
          where: and(
            eq(finishedGoodsStock.warehouseId, stockWarehouseId),
            eq(finishedGoodsStock.recipeId, item.recipeId),
          ),
          with: { recipe: true },
        });

        if (!stock)
          throw new Error(`Stock record not found for "${item.pack}"`);

        const containersPerCarton = effectiveCPP(
          stock.recipe.containersPerCarton ?? 0,
        );
        const recipeId = item.recipeId;
        const cartonSnapshot =
          recipeId &&
          stock.recipe?.cartonPackagingId != null &&
          containersPerCarton > 0
            ? (cartonSnapshotByRecipe.get(recipeId) ??
              (await getCartonInventorySnapshot({
                tx,
                warehouseId: stockWarehouseId,
                recipeId,
              })))
            : null;

        if (
          recipeId &&
          cartonSnapshot &&
          !cartonSnapshotByRecipe.has(recipeId)
        ) {
          cartonSnapshotByRecipe.set(recipeId, cartonSnapshot);
        }

        // Block custom pack sizes to prevent inventory corruption
        if (
          item.packsPerCarton &&
          item.packsPerCarton !== containersPerCarton
        ) {
          throw new Error(
            `Custom pack sizes are not allowed. Recipe "${item.pack}" uses ${containersPerCarton} per carton, but invoice specifies ${item.packsPerCarton}.`,
          );
        }

        const availability = buildFinishedGoodsAvailability({
          stock,
          containersPerCarton,
          cartonSnapshot,
        });
        const totalAvailableUnits = availability.sellableTotalUnits;

        const manualDiscountCartons =
          item.unitType === "carton"
            ? Math.max(0, item.discountCartons ?? 0)
            : 0;

        if (
          item.unitType === "carton" &&
          manualDiscountCartons > item.numberOfCartons
        ) {
          throw new Error(
            `Manual free cartons cannot exceed entered cartons for "${item.pack}".`,
          );
        }

        // ── Discount rule evaluation (distributor-specific, buy-N-get-M-free) ──
        let discountFreeCartons = 0;
        let matchedDiscountRuleId: string | null = null;

        if (item.unitType === "carton") {
          const recipeRules = discountRulesByRecipe.get(item.recipeId) || [];
          const ruleResolution = getApplicableDistributorFreeCartons({
            rules: recipeRules,
            recipeId: item.recipeId,
            numberOfCartons: item.numberOfCartons,
            manualFreeCartons: manualDiscountCartons,
          });
          matchedDiscountRuleId = ruleResolution.ruleId;
          discountFreeCartons = Math.max(0, ruleResolution.freeCartons);
        }

        const lineResolution = resolveCanonicalInvoiceLine({
          item,
          stock,
          containersPerCarton,
          pricingMode,
          configuredPricePerPack: recipePriceMap.get(item.recipeId),
          customerDefaultMargin: customerDefaultMarginUpdate,
          manualDiscountCartons,
          autoFreeCartons: discountFreeCartons,
          discountRuleId: matchedDiscountRuleId,
          preferConfiguredRate:
            !item.isPriceOverride && !item.preserveStoredDistributorRate,
        });

        const alreadyReservedUnits = item.recipeId
          ? (reservedUnitsByRecipe.get(item.recipeId) ?? 0)
          : 0;
        const alreadyReservedCartons = item.recipeId
          ? (reservedCartonsByRecipe.get(item.recipeId) ?? 0)
          : 0;
        const remainingAvailableUnits = Math.max(
          0,
          totalAvailableUnits - alreadyReservedUnits,
        );
        const requestedCartons =
          item.unitType === "carton"
            ? item.numberOfCartons + manualDiscountCartons + discountFreeCartons
            : 0;
        const remainingAvailableCartons = Math.max(
          0,
          availability.sellableCompleteCartons - alreadyReservedCartons,
        );

        if (
          item.unitType === "carton" &&
          requestedCartons > remainingAvailableCartons
        ) {
          throw new Error(
            `Not enough complete cartons for "${item.pack}". ` +
              `Available: ${remainingAvailableCartons} cartons.`,
          );
        }

        if (lineResolution.totalDispatchedUnits > remainingAvailableUnits) {
          throw new Error(
            `Not enough stock for "${item.pack}". Available: ${Math.floor(remainingAvailableUnits / containersPerCarton)} cartons & ${remainingAvailableUnits % containersPerCarton} units.`,
          );
        }

        if (item.recipeId) {
          physicalAvailableUnitsByRecipe.set(
            item.recipeId,
            availability.physicalTotalUnits,
          );
          reservedUnitsByRecipe.set(
            item.recipeId,
            alreadyReservedUnits + lineResolution.totalDispatchedUnits,
          );
          if (item.unitType === "carton") {
            reservedCartonsByRecipe.set(
              item.recipeId,
              alreadyReservedCartons + requestedCartons,
            );
          }
        }

        totalAmount += lineResolution.lineAmount;
        totalWeightKg += lineResolution.lineWeightKg;
        lineResolutions.push(lineResolution);
      }

      const invoiceDiscount = isRetailerInvoice
        ? roundMoney(Number(data.invoiceDiscount ?? 0))
        : 0;
      if (invoiceDiscount > totalAmount) {
        throw new Error(
          `Discount (${invoiceDiscount.toFixed(2)}) cannot exceed items total (${totalAmount.toFixed(2)}).`,
        );
      }
      const netInvoiceAmount = roundMoney(
        Math.max(0, totalAmount - invoiceDiscount),
      );
      const totalPayable = roundMoney(
        netInvoiceAmount + Number(data.expenses ?? 0),
      );

      const settlementPayments = await tx.query.payments.findMany({
        where: eq(payments.invoiceId, existing.id),
        columns: { amount: true, method: true, status: true },
      });
      const settlementPreview = calculateSettlement(
        totalPayable,
        settlementPayments.map((payment) => ({
          amount: Number(payment.amount),
          method: payment.method,
          status: payment.status,
        })),
      );
      assertSettlementDueDate(settlementPreview, data.paymentDueDate);

      const customerSettlement = await tx.query.customers.findFirst({
        where: eq(customers.id, customerId),
        columns: {
          outstandingAmount: true,
          creditLimit: true,
          creditHold: true,
          name: true,
        },
      });
      if (customerSettlement) {
        const oldOutstanding = Number(existing.outstandingAmount);
        const newOutstanding = settlementPreview.outstandingAmount;
        const increasesOutstanding = newOutstanding > oldOutstanding;
        if (customerSettlement.creditHold && increasesOutstanding) {
          throw new Error(
            `Customer "${customerSettlement.name}" is on payment hold. Outstanding Amount cannot be increased.`,
          );
        }
        const limit = Number(customerSettlement.creditLimit) || 0;
        const projectedOutstanding = roundMoney(
          Number(customerSettlement.outstandingAmount) -
            oldOutstanding +
            newOutstanding,
        );
        if (limit > 0 && projectedOutstanding > limit && increasesOutstanding) {
          throw new Error(
            `Outstanding limit exceeded for "${customerSettlement.name}". ` +
              `Limit: PKR ${limit.toFixed(2)}, Projected outstanding: PKR ${projectedOutstanding.toFixed(2)}.`,
          );
        }
      }

      const updateChanges: string[] = [];
      const updateChangeMetadata: Record<
        string,
        { old: unknown; new: unknown }
      > = {};

      if (existing.warehouseId !== data.warehouseId) {
        updateChanges.push("Warehouse changed");
        updateChangeMetadata.warehouseId = {
          old: existing.warehouseId,
          new: data.warehouseId,
        };
      }

      if (
        roundMoney(Number(existing.expenses)) !==
        roundMoney(Number(data.expenses ?? 0))
      ) {
        updateChanges.push(
          `Invoice Expense: ${formatMoney(Number(existing.expenses))} -> ${formatMoney(Number(data.expenses ?? 0))}`,
        );
        updateChangeMetadata.expenses = {
          old: Number(existing.expenses),
          new: Number(data.expenses ?? 0),
        };
      }

      if (
        normalizeText(existing.expensesDescription) !==
        normalizeText(data.expensesDescription)
      ) {
        updateChanges.push("Invoice Expense Note updated");
        updateChangeMetadata.expensesDescription = {
          old: existing.expensesDescription ?? null,
          new: data.expensesDescription ?? null,
        };
      }

      if (
        roundMoney(Number(existing.invoiceDiscount ?? 0)) !==
        roundMoney(invoiceDiscount)
      ) {
        updateChanges.push(
          `Discount: ${formatMoney(Number(existing.invoiceDiscount ?? 0))} -> ${formatMoney(invoiceDiscount)}`,
        );
        updateChangeMetadata.invoiceDiscount = {
          old: Number(existing.invoiceDiscount ?? 0),
          new: invoiceDiscount,
        };
      }

      if (
        normalizeText(existing.invoiceDiscountDescription) !==
        normalizeText(
          isRetailerInvoice ? data.invoiceDiscountDescription : undefined,
        )
      ) {
        updateChanges.push("Discount Note updated");
        updateChangeMetadata.invoiceDiscountDescription = {
          old: existing.invoiceDiscountDescription ?? null,
          new: isRetailerInvoice
            ? (data.invoiceDiscountDescription ?? null)
            : null,
        };
      }

      if (
        roundMoney(Number(existing.amount)) !== roundMoney(netInvoiceAmount)
      ) {
        updateChanges.push(
          `Net Sale Amount: ${formatMoney(Number(existing.amount))} -> ${formatMoney(netInvoiceAmount)}`,
        );
        updateChangeMetadata.amount = {
          old: Number(existing.amount),
          new: netInvoiceAmount,
        };
      }

      if (
        roundMoney(Number(existing.totalPrice)) !== roundMoney(totalPayable)
      ) {
        updateChanges.push(
          `Total Payable: ${formatMoney(Number(existing.totalPrice))} -> ${formatMoney(totalPayable)}`,
        );
        updateChangeMetadata.totalPrice = {
          old: Number(existing.totalPrice),
          new: totalPayable,
        };
      }

      if (
        formatDateValue(existing.paymentDueDate) !==
        formatDateValue(data.paymentDueDate)
      ) {
        updateChanges.push(
          `Payment Due Date: ${formatDateValue(existing.paymentDueDate)} -> ${formatDateValue(data.paymentDueDate)}`,
        );
        updateChangeMetadata.paymentDueDate = {
          old: existing.paymentDueDate ?? null,
          new: data.paymentDueDate ?? null,
        };
      }

      if (normalizeText(existing.remarks) !== normalizeText(data.remarks)) {
        updateChanges.push("Remarks updated");
        updateChangeMetadata.remarks = {
          old: existing.remarks ?? null,
          new: data.remarks ?? null,
        };
      }

      const existingItemsSignature = buildInvoiceItemSignature(existing.items);
      const updatedItemsSignature = buildInvoiceItemSignature(
        data.items.map((item) => ({
          recipeId: item.recipeId,
          pack: item.pack,
          numberOfCartons: item.numberOfCartons,
          numberOfUnits: item.numberOfUnits,
          discountCartons: item.discountCartons,
          perCartonPrice: item.perCartonPrice,
          retailPrice: item.retailPrice,
        })),
      );

      if (existingItemsSignature !== updatedItemsSignature) {
        updateChanges.push("Line items updated");
        updateChangeMetadata.items = {
          old: existingItemsSignature,
          new: updatedItemsSignature,
        };
      }

      await tx
        .update(invoices)
        .set({
          expenses: (data.expenses ?? 0).toString(),
          expensesDescription: data.expensesDescription,
          invoiceDiscount: invoiceDiscount.toString(),
          invoiceDiscountDescription: isRetailerInvoice
            ? data.invoiceDiscountDescription
            : null,
          amount: netInvoiceAmount.toString(),
          remarks: data.remarks,
          warehouseId: data.warehouseId,
          stockWarehouseId,
        })
        .where(eq(invoices.id, data.id));

      await recalculateInvoiceSettlement(tx, existing.id, {
        totalPrice: totalPayable,
        paymentDueDate: data.paymentDueDate ?? null,
      });

      // ── Insert NEW line items + deduct stock ──────────────────────────────
      const remainingUnitsByRecipe = new Map<string, number>();

      for (const r of lineResolutions) {
        const stockKey = r.item.recipeId;
        const totalAvailableUnits =
          physicalAvailableUnitsByRecipe.get(r.item.recipeId) ??
          r.stock.quantityCartons * r.containersPerCarton +
            r.stock.quantityContainers;
        const currentRemainingUnits =
          stockKey && remainingUnitsByRecipe.has(stockKey)
            ? remainingUnitsByRecipe.get(stockKey)!
            : totalAvailableUnits;
        const remainingUnits = currentRemainingUnits - r.totalDispatchedUnits;

        if (stockKey) {
          remainingUnitsByRecipe.set(stockKey, remainingUnits);
        }

        const hasCartons =
          r.stock.recipe?.cartonPackagingId != null &&
          r.stock.recipe?.containersPerCarton != null &&
          r.stock.recipe?.containersPerCarton > 0;

        const finalQuantityCartons = hasCartons
          ? Math.floor(remainingUnits / r.containersPerCarton)
          : 0;
        const finalQuantityContainers = hasCartons
          ? remainingUnits % r.containersPerCarton
          : remainingUnits;

        // Recalculate total inventory value after stock deduction
        const remainingTotalUnits = calculateTotalUnits(
          finalQuantityCartons,
          finalQuantityContainers,
          r.containersPerCarton,
        );
        const newTotalValue = calculateTotalInventoryValue(
          remainingTotalUnits,
          r.cogsPerUnit,
        );

        await tx
          .update(finishedGoodsStock)
          .set({
            quantityCartons: finalQuantityCartons,
            quantityContainers: finalQuantityContainers,
            totalInventoryValue: newTotalValue.toFixed(2),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(finishedGoodsStock.warehouseId, stockWarehouseId),
              eq(finishedGoodsStock.recipeId, r.item.recipeId),
            ),
          );

        await tx.insert(invoiceItems).values({
          id: createId(),
          invoiceId: data.id,
          recipeId: r.item.recipeId,
          pack: r.item.pack,
          numberOfCartons:
            r.item.unitType === "carton" ? r.item.numberOfCartons : 0,
          discountCartons: r.manualDiscountCartons,
          freeCartons: r.discountFreeCartons,
          quantity: r.item.unitType === "units" ? r.item.numberOfUnits : 0,
          packsPerCarton: r.containersPerCarton,
          actualPackSize: r.containersPerCarton,
          chargedUnits: r.chargedUnits,
          dispatchedUnits: r.totalDispatchedUnits,
          fillAmountSnapshot: r.fillAmountSnapshot.toFixed(3),
          fillUnitSnapshot: r.fillUnitSnapshot,
          perCartonPrice: r.pricingBreakdown.baseCartonRate.toString(),
          amount: r.pricingBreakdown.netAmount.toString(),
          hsnCode: r.item.hsnCode,
          retailPrice: r.item.retailPrice.toString(),
          margin: r.unitMargin.toString(),
          totalWeight: r.lineWeightKg.toFixed(3),
          tpPrice: r.tpPrice !== null ? r.tpPrice.toString() : null,
          marginPercent:
            r.marginPercent !== null ? r.marginPercent.toString() : null,
          isPriceOverride: r.item.isPriceOverride,
          discountRuleId: r.discountRuleId,
          costOfGoodsSold: r.cogsTotal.toFixed(2),
          costOfGoodsSoldPerUnit: r.cogsPerUnit.toFixed(4),
        });

        // ── Log pricing decision to audit trail (Task 8.3) ────────────────
        // Log the pricing decision for this invoice item
        // Requirement 8.5: Create price_change_log entry with source "invoice_calculation"
        if (r.productId) {
          await tx.insert(priceChangeLog).values({
            id: createId(),
            productId: r.productId,
            customerId: customerId,
            oldPrice: r.sourceBaseCartonRate.toString(),
            newPrice: r.pricingBreakdown.baseCartonRate.toString(),
            changedById: userId,
            source: "invoice_calculation",
            invoiceId: data.id,
            metadata: {
              discountRuleId: r.discountRuleId,
              freeCartons: r.discountFreeCartons,
              manualFreeCartons: r.manualDiscountCartons,
              appliedMarginPercent: r.marginPercent,
              grossAmount: r.pricingBreakdown.grossAmount,
              marginDeduction: r.pricingBreakdown.marginDeduction,
              schemeDeduction: r.pricingBreakdown.schemeDeduction,
              netAmount: r.pricingBreakdown.netAmount,
              effectiveCartonRate: r.pricingBreakdown.effectiveCartonRate,
              preserveStoredDistributorRate: Boolean(
                r.item.preserveStoredDistributorRate,
              ),
              isPriceOverride: r.item.isPriceOverride,
            },
          });
        }
      }

      // ── Update customer ledger ────────────────────────────────────────────
      await tx
        .update(customers)
        .set({
          totalSale: sql`${customers.totalSale} + ${netInvoiceAmount}`,
          weightSaleKg: sql`${customers.weightSaleKg} + ${totalWeightKg}`,
          expenses: sql`${customers.expenses} + ${data.expenses ?? 0}`,
        })
        .where(eq(customers.id, customerId));

      if (updateChanges.length > 0) {
        await recordInvoiceTimelineEvent(
          {
            invoiceId: data.id,
            eventType: "updated",
            title: `Invoice ${existing.invoiceNumber} updated`,
            description: updateChanges.join(". "),
            metadata: updateChangeMetadata,
            actorId: userId,
          },
          tx,
        );
      }

      return { id: data.id };
    });
  });
