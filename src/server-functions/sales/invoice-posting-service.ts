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
import { finishedGoodsStock, warehouses } from "@/db/schemas/inventory-schema";
import { cartons } from "@/db/schemas/manufacturing-schema";
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
	stockPolicy: "strict";
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

export async function postInvoice(
	tx: SalesTransaction,
	input: PostInvoiceInput,
): Promise<PostedInvoice> {
	const data = input;
	const userId = input.performedById;

	// ── Inline customer creation ─────────────────────────────────────────
	let customerId = data.customerId;
	if (input.source === "offline_import" && !customerId) {
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
		customerRecord?.customerType !== "distributor"
	) {
		throw new Error("Offline invoice requires an existing distributor");
	}
	const customerDefaultMargin = customerRecord?.defaultMargin
		? Number(customerRecord.defaultMargin)
		: null;
	const isRetailerInvoice = customerRecord?.customerType === "retailer";
	const pricingMode = getInvoicePricingMode(customerRecord?.customerType);
	const factoryFloorWarehouse = await resolveFactoryFloorWarehouse(tx);
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
			where: eq(invoices.orderId, data.orderId),
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

	for (const item of data.items) {
		const stock = await tx.query.finishedGoodsStock.findFirst({
			where: and(
				eq(finishedGoodsStock.warehouseId, stockWarehouseId),
				item.recipeId
					? eq(finishedGoodsStock.recipeId, item.recipeId)
					: undefined,
			),
			with: { recipe: true },
		});

		if (!stock) {
			throw new Error(`Stock record not found for "${item.pack}"`);
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
		const totalAvailableUnits = availability.sellableTotalUnits;

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
			customerDefaultMargin,
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
				`Not enough stock for "${item.pack}". ` +
					`Available: ${Math.floor(remainingAvailableUnits / containersPerCarton)} cartons & ` +
					`${remainingAvailableUnits % containersPerCarton} units.`,
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
	if (settlementPreview.outstandingAmount > 0 && input.source === "online") {
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
					fulfilledAt: new Date(),
					fulfilledAmount: commissionBaseAmount.toString(),
					updatedAt: new Date(),
				})
				.where(eq(orders.id, data.orderId));
		}

		await calculateCommissionForOrder(
			tx,
			orderBookerId,
			data.orderId,
			commissionBaseAmount,
		);
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
		const remainingUnits = currentRemainingUnits - r.totalDispatchedUnits;

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
		});

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
