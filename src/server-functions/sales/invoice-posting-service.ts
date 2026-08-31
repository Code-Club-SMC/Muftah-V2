import { createId } from "@paralleldrive/cuid2";
import type { SalesTransaction } from "./settlement-service";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import {
  discountRules,
  entityRecipeRates,
  orders,
  priceChangeLog,
  slipRecords,
} from "@/db/schemas/sales-erp-schema";
import {
  finishedGoodsStock,
  recipes,
  warehouses,
} from "@/db/schemas/inventory-schema";
import { stockReconciliationIssues } from "@/db/schemas/offline-sales-schema";
import { cartons, adjustmentLog } from "@/db/schemas/manufacturing-schema";
import type { CreateInvoiceInput } from "@/db/zod_schemas";
import { GENERAL_RECIPE_RATE_ENTITY_ID } from "@/lib/sales/entity-recipe-rate-config";
import { getApplicableDistributorFreeCartons } from "@/lib/sales/distributor-discount-rules";
import { effectiveCPP } from "@/lib/sales/effective-cpp";
import {
  calculateInvoiceLinePricing,
  type InvoicePricingMode,
} from "@/lib/sales/invoice-line-pricing";
import { allocateOnlineInvoiceNumber } from "@/lib/sales/invoice-number.server";
import {
  assertSettlementDueDate,
  calculateSettlement,
} from "@/lib/sales/settlement/math";
import { moneyString, roundMoney } from "@/lib/sales/settlement/money";
import { calculateTotalInventoryValue, calculateTotalUnits } from "@/lib/wac";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { calculateCommissionForOrder } from "./order-booker-commission-calc";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";
import { createInitialPayments } from "./settlement-service";

export type PostedInvoice = typeof invoices.$inferSelect;

export type PostInvoiceInput = CreateInvoiceInput & {
  performedById: string;
  source: "online" | "offline_import";
  businessDate: Date;
  publicInvoiceNumber?: string;
  stockPolicy: "strict" | "offline_reconcile";
  creditPolicy: "block" | "warn";
  pricingPolicy: "live" | "signed_snapshot";
  offlineSalesSlotId?: string;
  offlineSaleType?: "direct_distributor" | "booked_order";
  commissionPolicy?: "normal" | "suppress";
  signedLineSnapshots?: Array<{
    stagedItemId: string;
    recipeId: string;
    baseCartonPrice: number;
    freeCartons: number;
    chargedUnits: number;
    dispatchedUnits: number;
    lineAmount: number;
    wacPerPack: number;
    stockUnitsSnapshot: number;
  }>;
};

const getInvoicePricingMode = (
  customerType: string | null | undefined,
): InvoicePricingMode =>
  customerType === "distributor" ? "distributor" : "retailer";

const resolveFactoryFloorWarehouse = async (tx: SalesTransaction) => {
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

const resolveInvoiceStockWarehouse = async (
  tx: SalesTransaction,
  input: PostInvoiceInput,
) => {
  if (input.source === "online") return await resolveFactoryFloorWarehouse(tx);
  const signedWarehouse = await tx.query.warehouses.findFirst({
    where: and(
      eq(warehouses.id, input.warehouseId),
      eq(warehouses.type, "factory_floor"),
    ),
    columns: { id: true, name: true },
  });
  if (!signedWarehouse) {
    throw new Error("Signed offline factory warehouse is no longer available");
  }
  return signedWarehouse;
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
  stockRecordExists: boolean;
  liveAvailableUnits: number;
  deductedUnits: number;
  deficitUnits: number;
  stockUnitsSnapshot: number;
  stagedItemId: string | null;
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
    stockRecordExists: true,
    liveAvailableUnits: 0,
    deductedUnits: pricingBreakdown.dispatchedUnits,
    deficitUnits: 0,
    stockUnitsSnapshot: 0,
    stagedItemId: null,
  };
};

export async function postInvoice(
  tx: SalesTransaction,
  input: PostInvoiceInput,
): Promise<PostedInvoice> {
  const data = input;
  const userId = input.performedById;

  // ── Inline customer creation ─────────────────────────────────────────
  let customerId = data.customerId;
  if (
    input.source === "offline_import" &&
    input.offlineSaleType === "direct_distributor" &&
    !customerId
  ) {
    throw new Error("Offline invoice requires an existing distributor");
  }
  if (!customerId && data.customerName) {
    const [newCustomer] = await tx
      .insert(customers)
      .values({
        name: data.customerName,
        mobileNumber: data.customerMobile,
        cnic: data.customerCnic,
        city: data.customerCity,
        state: data.customerState,
        bankAccount: data.customerBankAccount,
        customerType: data.customerType || "retailer",
        salesmanId: data.salesmanId || null,
      })
      .returning();
    customerId = newCustomer.id;
  }

  if (!customerId) {
    throw new Error("Customer is required to create an invoice.");
  }

  // Fetch customer for default margin
  const customerRecord = await tx.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { defaultMargin: true, customerType: true },
  });
  if (
    input.source === "offline_import" &&
    input.offlineSaleType === "direct_distributor" &&
    customerRecord?.customerType !== "distributor"
  ) {
    throw new Error("Offline invoice requires an existing distributor");
  }
  const customerDefaultMargin = customerRecord?.defaultMargin
    ? Number(customerRecord.defaultMargin)
    : null;
  const isRetailerInvoice = customerRecord?.customerType === "retailer";
  const pricingMode = getInvoicePricingMode(customerRecord?.customerType);
  const factoryFloorWarehouse = await resolveInvoiceStockWarehouse(tx, input);
  const stockWarehouseId = factoryFloorWarehouse.id;

  let orderBookerId: string | null = null;
  let linkedOrderStatus: string | null = null;
  let linkedOrderFulfilledAmount = 0;
  if (data.orderId) {
    const linkedOrder = await tx.query.orders.findFirst({
      where: eq(orders.id, data.orderId),
      columns: {
        id: true,
        orderBookerId: true,
        status: true,
        fulfilledAmount: true,
      },
    });
    if (!linkedOrder) {
      throw new Error("Linked order not found.");
    }

    if (linkedOrder.status === "returned") {
      throw new Error("Returned orders cannot be converted into invoices.");
    }

    const existingLinkedInvoice = await tx.query.invoices.findFirst({
      where: and(
        eq(invoices.orderId, data.orderId),
        eq(invoices.status, "saved"),
      ),
      columns: { id: true, invoiceNumber: true },
    });

    if (existingLinkedInvoice) {
      throw new Error(
        `Order already converted to invoice ${existingLinkedInvoice.invoiceNumber}.`,
      );
    }

    orderBookerId = linkedOrder.orderBookerId;
    linkedOrderStatus = linkedOrder.status;
    linkedOrderFulfilledAmount = Number(linkedOrder.fulfilledAmount ?? 0);
  }

  // Fetch distributor-only active free-unit rules + server-authoritative recipe rates
  const [distributorDiscountRules, recipePriceMap] =
    input.pricingPolicy === "signed_snapshot"
      ? [[], new Map<string, number>()]
      : await Promise.all([
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
            customerType: customerRecord?.customerType,
            customerId,
            orderBookerId,
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

  // ── Single-pass: validate stock + resolve prices + compute totals ─────
  const lineResolutions: InvoiceLineResolution[] = [];
  let totalAmount = 0;
  let totalWeightKg = 0;

  const reservedUnitsByRecipe = new Map<string, number>();
  const reservedCartonsByRecipe = new Map<string, number>();
  const physicalAvailableUnitsByRecipe = new Map<string, number>();
  const cartonSnapshotByRecipe = new Map<string, CartonInventorySnapshot>();

  for (const [itemIndex, item] of data.items.entries()) {
    let stock: any = await tx.query.finishedGoodsStock.findFirst({
      where: and(
        eq(finishedGoodsStock.warehouseId, stockWarehouseId),
        item.recipeId
          ? eq(finishedGoodsStock.recipeId, item.recipeId)
          : undefined,
      ),
      with: { recipe: true },
    });

    const stockRecordExists = Boolean(stock);
    if (!stock && input.stockPolicy === "offline_reconcile" && item.recipeId) {
      const recipe = await tx.query.recipes.findFirst({
        where: eq(recipes.id, item.recipeId),
      });
      if (recipe) {
        stock = {
          warehouseId: stockWarehouseId,
          recipeId: item.recipeId,
          quantityCartons: 0,
          quantityContainers: 0,
          weightedAverageCostPerPack: "0",
          recipe,
        };
      }
    }

    if (!stock) {
      throw new Error(`Stock record not found for "${item.pack}"`);
    }
    const signedLine = input.signedLineSnapshots?.[itemIndex];
    if (signedLine && signedLine.recipeId !== item.recipeId) {
      throw new Error(
        `Signed offline line identity is invalid for "${item.pack}"`,
      );
    }
    if (input.pricingPolicy === "signed_snapshot" && !signedLine) {
      throw new Error(`Signed offline pricing is missing for "${item.pack}"`);
    }

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

    if (recipeId && cartonSnapshot && !cartonSnapshotByRecipe.has(recipeId)) {
      cartonSnapshotByRecipe.set(recipeId, cartonSnapshot);
    }

    // Block custom pack sizes to prevent inventory corruption
    if (item.packsPerCarton && item.packsPerCarton !== containersPerCarton) {
      throw new Error(
        `Custom pack sizes are not allowed. Recipe "${item.pack}" uses ${containersPerCarton} per carton, but invoice specifies ${item.packsPerCarton}.`,
      );
    }

    const availability = buildFinishedGoodsAvailability({
      stock,
      containersPerCarton,
      cartonSnapshot,
    });
    const totalAvailableUnits =
      input.stockPolicy === "offline_reconcile"
        ? availability.physicalTotalUnits
        : availability.sellableTotalUnits;

    const manualDiscountCartons =
      item.unitType === "carton" ? Math.max(0, item.discountCartons ?? 0) : 0;

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

    if (
      item.unitType === "carton" &&
      input.pricingPolicy === "signed_snapshot"
    ) {
      discountFreeCartons = Math.max(0, signedLine?.freeCartons ?? 0);
    } else if (item.unitType === "carton") {
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

    let lineResolution = resolveCanonicalInvoiceLine({
      item,
      stock,
      containersPerCarton,
      pricingMode,
      configuredPricePerPack:
        input.pricingPolicy === "signed_snapshot"
          ? undefined
          : recipePriceMap.get(item.recipeId),
      customerDefaultMargin,
      manualDiscountCartons,
      autoFreeCartons: discountFreeCartons,
      discountRuleId: matchedDiscountRuleId,
      preferConfiguredRate:
        input.pricingPolicy !== "signed_snapshot" &&
        !item.isPriceOverride &&
        !item.preserveStoredDistributorRate,
    });

    if (signedLine) {
      const signedPricing = {
        ...lineResolution.pricingBreakdown,
        baseCartonRate: roundMoney(signedLine.baseCartonPrice),
        effectiveCartonRate: roundMoney(signedLine.baseCartonPrice),
        baseUnitRate: roundMoney(
          signedLine.baseCartonPrice / containersPerCarton,
        ),
        effectiveUnitRate: roundMoney(
          signedLine.baseCartonPrice / containersPerCarton,
        ),
        freeCartonsTotal: signedLine.freeCartons,
        chargedCartons: item.unitType === "carton" ? item.numberOfCartons : 0,
        chargedUnits: signedLine.chargedUnits,
        dispatchedUnits: signedLine.dispatchedUnits,
        grossAmount: signedLine.lineAmount,
        marginDeduction: 0,
        schemeDeduction: 0,
        netAmount: signedLine.lineAmount,
        costOfGoodsSold: roundMoney(
          signedLine.dispatchedUnits * signedLine.wacPerPack,
        ),
        profit: roundMoney(
          signedLine.lineAmount -
            signedLine.dispatchedUnits * signedLine.wacPerPack,
        ),
      };
      if (
        roundMoney(Number(item.perCartonPrice)) !==
          roundMoney(signedLine.baseCartonPrice) ||
        signedLine.chargedUnits < 0 ||
        signedLine.dispatchedUnits < signedLine.chargedUnits ||
        roundMoney(signedLine.lineAmount) < 0
      ) {
        throw new Error(`Signed offline line is invalid for "${item.pack}"`);
      }
      lineResolution = {
        ...lineResolution,
        chargedUnits: signedLine.chargedUnits,
        requestedUnits: signedLine.dispatchedUnits,
        discountUnits: signedLine.freeCartons * containersPerCarton,
        discountFreeCartons: signedLine.freeCartons,
        totalDispatchedUnits: signedLine.dispatchedUnits,
        baseCartonRate: signedLine.baseCartonPrice,
        unitCostPerPack: signedLine.wacPerPack,
        cogsPerUnit: signedLine.wacPerPack,
        cogsTotal: roundMoney(
          signedLine.dispatchedUnits * signedLine.wacPerPack,
        ),
        lineAmount: signedLine.lineAmount,
        pricingBreakdown: signedPricing,
        unitMargin:
          signedLine.chargedUnits > 0
            ? roundMoney(
                signedLine.lineAmount / signedLine.chargedUnits -
                  signedLine.wacPerPack,
              )
            : 0,
        stockUnitsSnapshot: signedLine.stockUnitsSnapshot,
        stagedItemId: signedLine.stagedItemId,
      };
    }

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
      input.stockPolicy === "strict" &&
      item.unitType === "carton" &&
      requestedCartons > remainingAvailableCartons
    ) {
      throw new Error(
        `Not enough complete cartons for "${item.pack}". ` +
          `Available: ${remainingAvailableCartons} cartons.`,
      );
    }

    if (
      input.stockPolicy === "strict" &&
      lineResolution.totalDispatchedUnits > remainingAvailableUnits
    ) {
      throw new Error(
        `Not enough stock for "${item.pack}". ` +
          `Available: ${Math.floor(remainingAvailableUnits / containersPerCarton)} cartons & ` +
          `${remainingAvailableUnits % containersPerCarton} units.`,
      );
    }

    const deductedUnits = Math.min(
      remainingAvailableUnits,
      lineResolution.totalDispatchedUnits,
    );
    const deficitUnits = lineResolution.totalDispatchedUnits - deductedUnits;
    lineResolution = {
      ...lineResolution,
      stockRecordExists,
      liveAvailableUnits: remainingAvailableUnits,
      deductedUnits,
      deficitUnits,
    };

    if (item.recipeId) {
      physicalAvailableUnitsByRecipe.set(
        item.recipeId,
        availability.physicalTotalUnits,
      );
      reservedUnitsByRecipe.set(
        item.recipeId,
        alreadyReservedUnits + deductedUnits,
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

  const settlementPreview = calculateSettlement(
    totalPayable,
    data.payments.map((payment) => ({
      amount: payment.amount,
      method: payment.method,
      status: payment.method === "cash" ? "confirmed" : "pending",
    })),
  );
  assertSettlementDueDate(settlementPreview, data.paymentDueDate);

  // ── Outstanding-limit and hold enforcement ────────────────────────────
  if (
    settlementPreview.outstandingAmount > 0 &&
    input.creditPolicy === "block"
  ) {
    const customerRecord = await tx.query.customers.findFirst({
      where: eq(customers.id, customerId),
      columns: {
        outstandingAmount: true,
        creditLimit: true,
        creditHold: true,
        name: true,
      },
    });
    if (customerRecord) {
      if (customerRecord.creditHold) {
        throw new Error(
          `Customer "${customerRecord.name}" is on payment hold. New outstanding invoices are blocked.`,
        );
      }
      const currentOutstanding = Number(customerRecord.outstandingAmount) || 0;
      const creditLimit = Number(customerRecord.creditLimit) || 0;
      if (
        creditLimit > 0 &&
        currentOutstanding + settlementPreview.outstandingAmount > creditLimit
      ) {
        throw new Error(
          `Outstanding limit exceeded for "${customerRecord.name}". ` +
            `Limit: PKR ${creditLimit.toFixed(2)}, Current outstanding: PKR ${currentOutstanding.toFixed(2)}, ` +
            `This invoice outstanding amount: PKR ${settlementPreview.outstandingAmount.toFixed(2)}.`,
        );
      }
    }
  }

  const invoiceNumber =
    input.source === "online"
      ? await allocateOnlineInvoiceNumber(tx)
      : input.publicInvoiceNumber;
  if (!invoiceNumber) {
    throw new Error("Offline public invoice number is required");
  }

  // ── Create invoice ────────────────────────────────────────────────────
  const [invoice] = await tx
    .insert(invoices)
    .values({
      customerId,
      invoiceNumber,
      source: input.source,
      paidAmount: "0.00",
      outstandingAmount: moneyString(totalPayable),
      paymentDueDate: data.paymentDueDate ?? null,
      paymentStatus: "unpaid",
      expenses: (data.expenses ?? 0).toString(),
      expensesDescription: data.expensesDescription,
      invoiceDiscount: invoiceDiscount.toString(),
      invoiceDiscountDescription: isRetailerInvoice
        ? data.invoiceDiscountDescription
        : null,
      amount: netInvoiceAmount.toString(),
      totalPrice: totalPayable.toString(),
      remarks: data.remarks,
      warehouseId: data.warehouseId,
      stockWarehouseId,
      performedById: userId,
      salesmanId: data.salesmanId || null,
      status: "saved",
      date: input.businessDate,
      orderId: data.orderId || null,
      orderBookerId,
      offlineSalesSlotId: input.offlineSalesSlotId ?? null,
    })
    .returning();

  // ── Mark linked order as delivered ───────────────────────────────────
  if (data.orderId && orderBookerId) {
    const commissionBaseAmount =
      linkedOrderStatus === "delivered" && linkedOrderFulfilledAmount > 0
        ? linkedOrderFulfilledAmount
        : totalPayable;

    if (linkedOrderStatus !== "delivered") {
      await tx
        .update(orders)
        .set({
          status: "delivered",
          fulfilledAt: input.businessDate,
          fulfilledAmount: commissionBaseAmount.toString(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, data.orderId));
    }

    if (input.commissionPolicy !== "suppress") {
      await calculateCommissionForOrder(
        tx,
        orderBookerId,
        data.orderId,
        commissionBaseAmount,
        input.businessDate,
      );
    }
  }

  // ── Create slip record ────────────────────────────────────────────────
  await tx.insert(slipRecords).values({
    id: createId(),
    slipNumber: invoiceNumber,
    invoiceId: invoice.id,
    customerId,
    salesmanId: data.salesmanId || null,
    invoiceAmount: moneyString(totalPayable),
    paidAmount: "0.00",
    outstandingAmount: moneyString(totalPayable),
    status: "open",
    issuedAt: input.businessDate,
  });

  // ── Timeline event ────────────────────────────────────────────────────
  await recordInvoiceTimelineEvent(
    {
      invoiceId: invoice.id,
      eventType: "created",
      title: `Invoice ${invoiceNumber} created`,
      description:
        `Total: PKR ${totalPayable.toFixed(2)}. ` +
        `Paid Amount: PKR ${settlementPreview.paidAmount.toFixed(2)}. ` +
        `Outstanding Amount: PKR ${settlementPreview.outstandingAmount.toFixed(2)}. ` +
        (invoiceDiscount > 0
          ? `Discount: PKR ${invoiceDiscount.toFixed(2)}. `
          : "") +
        (data.paymentDueDate
          ? `Payment Due Date: ${data.paymentDueDate.toISOString()}.`
          : ""),
      metadata: {
        invoiceNumber,
        totalPrice: totalPayable,
        invoiceDiscount,
        paidAmount: settlementPreview.paidAmount,
        pendingAmount: settlementPreview.pendingAmount,
        outstandingAmount: settlementPreview.outstandingAmount,
        paymentDueDate: data.paymentDueDate?.toISOString() ?? null,
        warehouseId: data.warehouseId,
        stockWarehouseId,
        customerId,
        source: input.source,
      },
      actorId: userId,
      eventDate: input.businessDate,
    },
    tx,
  );

  // ── Insert line items + deduct stock (single loop, uses cached resolutions) ──
  const remainingUnitsByRecipe = new Map<string, number>();
  for (const r of lineResolutions) {
    if (!r.item.recipeId) continue;

    const stockKey = r.item.recipeId;
    const totalAvailableUnits =
      physicalAvailableUnitsByRecipe.get(stockKey) ??
      r.stock.quantityCartons * r.containersPerCarton +
        r.stock.quantityContainers;
    const currentRemainingUnits =
      stockKey && remainingUnitsByRecipe.has(stockKey)
        ? remainingUnitsByRecipe.get(stockKey)!
        : totalAvailableUnits;
    const remainingUnits = Math.max(0, currentRemainingUnits - r.deductedUnits);

    if (stockKey) {
      remainingUnitsByRecipe.set(stockKey, remainingUnits);
    }

    const hasCartons =
      (r.stock as any).recipe?.cartonPackagingId != null &&
      (r.stock as any).recipe?.containersPerCarton != null &&
      (r.stock as any).recipe?.containersPerCarton > 0;

    const finalQuantityCartons = hasCartons
      ? Math.floor(remainingUnits / r.containersPerCarton)
      : 0;
    const finalQuantityContainers = hasCartons
      ? remainingUnits % r.containersPerCarton
      : remainingUnits;

    // Recalculate total inventory value after stock deduction.
    // WAC per unit stays the same on dispatch; only total value changes.
    const remainingTotalUnits = calculateTotalUnits(
      finalQuantityCartons,
      finalQuantityContainers,
      r.containersPerCarton,
    );
    const newTotalValue = calculateTotalInventoryValue(
      remainingTotalUnits,
      r.cogsPerUnit,
    );

    if (r.stockRecordExists) {
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
    }

    // ── Dispatch Cartons (if sold by carton) ────────────────────────────
    if (hasCartons && r.item.unitType === "carton" && r.totalDispatchedUnits > 0) {
      const cartonsToDispatch = Math.floor(r.totalDispatchedUnits / r.containersPerCarton);
      
      if (cartonsToDispatch > 0) {
        // Fetch COMPLETE cartons (and then PARTIAL if needed)
        const availableCartons = await tx.query.cartons.findMany({
          where: and(
            eq(cartons.warehouseId, stockWarehouseId),
            eq(cartons.recipeId, r.item.recipeId),
            inArray(cartons.status, ["COMPLETE", "SEALED", "PARTIAL"])
          ),
          orderBy: (cartons, { asc }) => [asc(cartons.createdAt)],
        });

        // Filter and sort to prefer COMPLETE/SEALED over PARTIAL
        const sortedCartons = [
          ...availableCartons.filter(c => c.status === "COMPLETE" || c.status === "SEALED"),
          ...availableCartons.filter(c => c.status === "PARTIAL")
        ];

        let dispatchedCount = 0;
        let unitsToFulfill = r.totalDispatchedUnits;

        for (const carton of sortedCartons) {
          if (dispatchedCount >= cartonsToDispatch && unitsToFulfill <= 0) break;
          
          const packsToTake = Math.min(carton.currentPacks, unitsToFulfill);
          if (packsToTake <= 0) continue;

          const isFullDispatch = packsToTake === carton.currentPacks;
          const newStatus = isFullDispatch ? "DISPATCHED" : "PARTIAL";
          const dispatchType = isFullDispatch ? "DISPATCH_FULL" : "DISPATCH_PARTIAL";
          
          const setFields: Partial<typeof cartons.$inferInsert> = {
            currentPacks: carton.currentPacks - packsToTake,
            status: newStatus,
            updatedAt: new Date(),
          };

          if (isFullDispatch) {
            setFields.dispatchedAt = new Date();
            setFields.dispatchOrderId = invoice.id;
          }

          if (carton.status === "SEALED" && !isFullDispatch) {
             // unseal log
             await tx.insert(adjustmentLog).values({
               id: createId(),
               cartonId: carton.id,
               batchId: carton.productionRunId,
               sku: carton.sku,
               type: "UNSEALED",
               packsBefore: carton.currentPacks,
               delta: 0,
               packsAfter: carton.currentPacks,
               reason: "Unsealed for partial dispatch",
               performedBy: userId,
               performedAt: new Date(),
             });
          }

          await tx.update(cartons).set(setFields).where(eq(cartons.id, carton.id));

          await tx.insert(adjustmentLog).values({
            id: createId(),
            cartonId: carton.id,
            batchId: carton.productionRunId,
            sku: carton.sku,
            type: dispatchType,
            packsBefore: carton.currentPacks,
            delta: -packsToTake,
            packsAfter: carton.currentPacks - packsToTake,
            reason: isFullDispatch ? "Full dispatch" : `Partial dispatch: ${packsToTake} of ${carton.currentPacks}`,
            dispatchOrderId: invoice.id,
            performedBy: userId,
            performedAt: new Date(),
          });

          if (isFullDispatch) {
            dispatchedCount++;
          }
          unitsToFulfill -= packsToTake;
        }

        if (unitsToFulfill > 0) {
          throw new Error(`Not enough pack inventory in cartons to dispatch ${r.totalDispatchedUnits} units for "${r.item.pack}".`);
        }
      }
    }

    const [savedItem] = await tx
      .insert(invoiceItems)
      .values({
        id: createId(),
        invoiceId: invoice.id,
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
      })
      .returning({ id: invoiceItems.id });
    if (!savedItem) throw new Error("Invoice item could not be saved");

    if (input.stockPolicy === "offline_reconcile" && r.deficitUnits > 0) {
      await tx.insert(stockReconciliationIssues).values({
        id: createId(),
        invoiceId: invoice.id,
        invoiceItemId: savedItem.id,
        recipeId: r.item.recipeId,
        warehouseId: stockWarehouseId,
        requestedUnits: r.totalDispatchedUnits,
        availableUnits: r.liveAvailableUnits,
        deficitUnits: r.deficitUnits,
        snapshotStockUnits: r.stockUnitsSnapshot,
        liveStockUnits: r.liveAvailableUnits,
      });
    }

    // ── Log pricing decision to audit trail ────────────────────────────
    if (r.productId) {
      await tx.insert(priceChangeLog).values({
        id: createId(),
        productId: r.productId,
        customerId: customerId,
        oldPrice: r.sourceBaseCartonRate.toString(),
        newPrice: r.pricingBreakdown.baseCartonRate.toString(),
        changedById: userId,
        source: "invoice_calculation",
        invoiceId: invoice.id,
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
      outstandingAmount: sql`${customers.outstandingAmount} + ${totalPayable}`,
      weightSaleKg: sql`${customers.weightSaleKg} + ${totalWeightKg}`,
      expenses: sql`${customers.expenses} + ${data.expenses ?? 0}`,
    })
    .where(eq(customers.id, customerId));

  await createInitialPayments(tx, {
    invoiceId: invoice.id,
    actorId: userId,
    source: input.source === "online" ? "invoice_creation" : "offline_import",
    payments: data.payments,
  });

  const postedInvoice = await tx.query.invoices.findFirst({
    where: eq(invoices.id, invoice.id),
  });
  if (!postedInvoice) throw new Error("Posted invoice could not be loaded");
  return postedInvoice;
}
