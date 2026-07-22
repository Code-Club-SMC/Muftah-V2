import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recipes } from "@/db/schemas/inventory-schema";
import {
	buildSnapshot,
	type CompanySnapshot,
	loadContext,
	type RealizedInvoiceLine,
} from "./company-reporting-core";
import { aggregateRealizedInvoiceRows } from "./reporting-aggregation";
import {
	buildVariantLabel,
	calculateDelta,
	calculateMetrics,
	calculatePointDelta,
	createComparisonLabel,
	createPeriodLabel,
	createPreviousRange,
	createReportDateRange,
	hasMeaningfulValue,
	type PnlMetrics,
	type ReportDateRange,
} from "./reporting-math";

const DEFAULT_TREND_MONTHS = 6;
type FailedBatchLossRecord = Awaited<
	ReturnType<typeof loadContext>
>["failedProductionLosses"][number];

export type ProfitStatusKey = "profit" | "loss" | "break_even" | "no_activity";

export interface ProfitStatus {
	key: ProfitStatusKey;
	label: string;
	description: string;
}

export interface PnlTrendPoint extends PnlMetrics {
	monthKey: string;
	monthLabel: string;
}

interface ScopeFilter {
	productId?: string;
	recipeId?: string;
	fromDate: Date;
	toDate: Date;
}

export interface RecipeBreakdownRow extends PnlMetrics {
	recipeId: string;
	recipeName: string;
	variantLabel: string | null;
	recipeCode: string | null;
	realizedCartons: number;
}

export interface ScopedFailedBatchLossRow {
	settlementId: string;
	productionRunId: string;
	batchId: string;
	settledAt: string;
	recipeId: string;
	recipeName: string;
	productId: string;
	productName: string;
	chemicalId: string;
	chemicalName: string;
	expectedQuantity: number;
	recoveredQuantity: number;
	lossQuantity: number;
	costPerUnit: number;
	lossAmount: number;
}

export interface RealizedInvoiceRow {
	invoiceId: string;
	invoiceNumber: string | null;
	invoiceDate: string;
	customerName: string;
	recipeId: string | null;
	recipeName: string | null;
	variantLabel: string | null;
	pack: string;
	realizedRevenue: number;
	realizedCogs: number;
	realizedProfit: number;
	realizedUnits: number;
	realizedCartons: number;
	realizedRatio: number;
	paymentToDate: number;
	adjustedLineRevenue: number;
	adjustedLineCogs: number;
	invoiceStatus: string;
}

export {
	buildVariantLabel,
	calculateDelta,
	calculateMetrics,
	calculatePointDelta,
	createComparisonLabel,
	createPeriodLabel,
	createPreviousRange,
	createReportDateRange,
	hasMeaningfulValue,
	type PnlMetrics,
	type ReportDateRange,
};

function roundCurrency(value: number): number {
	return Number(value.toFixed(2));
}

function roundMetric(value: number): number {
	return Number(value.toFixed(4));
}

function filterLinesByScope(
	lines: RealizedInvoiceLine[],
	scope: Pick<ScopeFilter, "productId" | "recipeId">,
): RealizedInvoiceLine[] {
	return lines.filter((line) => {
		if (scope.recipeId) {
			return line.recipeId === scope.recipeId;
		}

		if (scope.productId) {
			return line.productId === scope.productId;
		}

		return true;
	});
}

function filterFailedBatchLossesByScope(
	losses: FailedBatchLossRecord[],
	scope: Pick<ScopeFilter, "productId" | "recipeId">,
): FailedBatchLossRecord[] {
	return losses.filter((loss) => {
		if (scope.recipeId) {
			return loss.recipeId === scope.recipeId;
		}

		if (scope.productId) {
			return loss.productId === scope.productId;
		}

		return true;
	});
}

function metricsFromLines(
	lines: RealizedInvoiceLine[],
	failedBatchLosses = 0,
): PnlMetrics {
	const realizedLines = lines.filter(
		(line) =>
			hasMeaningfulValue(line.realizedRevenue) ||
			hasMeaningfulValue(line.realizedCogs) ||
			hasMeaningfulValue(line.realizedUnits),
	);
	const totalRevenue = roundCurrency(
		realizedLines.reduce((sum, line) => sum + line.realizedRevenue, 0),
	);
	const totalCogs = roundCurrency(
		realizedLines.reduce((sum, line) => sum + line.realizedCogs, 0),
	);
	const soldUnits = roundMetric(
		realizedLines.reduce((sum, line) => sum + line.realizedUnits, 0),
	);
	const invoiceCount = new Set(realizedLines.map((line) => line.invoiceId))
		.size;

	return calculateMetrics({
		totalRevenue,
		totalCogs,
		soldUnits,
		invoiceCount,
		failedBatchLosses: roundCurrency(failedBatchLosses),
	});
}

export function buildScopedStatus(metrics: PnlMetrics): ProfitStatus {
	const hasActivity =
		hasMeaningfulValue(metrics.totalRevenue) ||
		hasMeaningfulValue(metrics.totalCogs) ||
		hasMeaningfulValue(metrics.soldUnits) ||
		hasMeaningfulValue(metrics.failedBatchLosses);
	const hasFailedBatchLosses = hasMeaningfulValue(metrics.failedBatchLosses);
	const statusAmount = hasFailedBatchLosses
		? metrics.netImpact
		: metrics.netProfit;

	if (!hasActivity) {
		return {
			key: "no_activity",
			label: "No activity",
			description:
				"No realized sales or failed-batch chemical losses were recorded for this scope in the selected period.",
		};
	}

	if (Math.abs(statusAmount) < 0.005) {
		return {
			key: "break_even",
			label: "Break-even",
			description: hasFailedBatchLosses
				? "Realized revenue matched sold cost after failed-batch chemical losses for this scope."
				: "Realized revenue matched sold cost without a meaningful profit or loss.",
		};
	}

	if (statusAmount > 0) {
		return {
			key: "profit",
			label: "Profit",
			description: hasFailedBatchLosses
				? "Realized revenue still covered sold cost and failed-batch chemical losses for this scope."
				: "Realized revenue exceeded the actual sold cost for this scope.",
		};
	}

	return {
		key: "loss",
		label: "Loss",
		description: hasFailedBatchLosses
			? "Sold cost and failed-batch chemical losses exceeded realized revenue for this scope."
			: "Actual sold cost exceeded realized revenue for this scope.",
	};
}

export async function fetchScopedInvoiceRows(
	scope: Pick<ScopeFilter, "productId" | "recipeId">,
	range: ReportDateRange,
): Promise<RealizedInvoiceRow[]> {
	const context = await loadContext(range.fromDate, range.toDate);
	const snapshot = buildSnapshot(context, range);
	const lines = filterLinesByScope(snapshot.realizedLines, scope)
		.filter(
			(line) =>
				hasMeaningfulValue(line.realizedRevenue) ||
				hasMeaningfulValue(line.realizedCogs) ||
				hasMeaningfulValue(line.realizedUnits),
		)
		.sort(
			(left, right) => right.invoiceDate.getTime() - left.invoiceDate.getTime(),
		);

	const variantLabelMap = await buildVariantLabelMap(
		Array.from(
			new Set(lines.map((line) => line.recipeId).filter(Boolean) as string[]),
		),
	);

	const aggregated = aggregateRealizedInvoiceRows(lines, variantLabelMap);

	return aggregated.sort(
		(left, right) =>
			new Date(right.invoiceDate).getTime() -
			new Date(left.invoiceDate).getTime(),
	);
}

async function buildVariantLabelMap(
	recipeIds: string[],
): Promise<Map<string, string | null>> {
	if (recipeIds.length === 0) {
		return new Map();
	}

	const rows = await db.query.recipes.findMany({
		where: inArray(recipes.id, recipeIds),
		columns: {
			id: true,
			fillAmount: true,
			fillUnit: true,
		},
	});

	return new Map(
		rows.map((row) => [
			row.id,
			buildVariantLabel(row.fillAmount, row.fillUnit),
		]),
	);
}

export async function fetchScopedSummary(
	scope: ScopeFilter,
): Promise<PnlMetrics> {
	const context = await loadContext(scope.fromDate, scope.toDate);
	const snapshot = buildSnapshot(context, {
		fromDate: scope.fromDate,
		toDate: scope.toDate,
	});
	const lines = filterLinesByScope(snapshot.realizedLines, scope);
	const failedBatchLosses = filterFailedBatchLossesByScope(
		context.failedProductionLosses,
		scope,
	).reduce((sum, loss) => sum + loss.lossAmount, 0);

	return metricsFromLines(lines, failedBatchLosses);
}

export async function fetchScopedTrend(
	scope: Pick<ScopeFilter, "productId" | "recipeId"> & {
		endDate: Date;
		months?: number;
	},
): Promise<PnlTrendPoint[]> {
	const months = scope.months ?? DEFAULT_TREND_MONTHS;
	const fromDate = startOfMonth(addMonths(scope.endDate, -months + 1));
	const toDate = endOfMonth(scope.endDate);

	const context = await loadContext(fromDate, toDate);
	const trend: PnlTrendPoint[] = [];

	for (let monthIndex = 0; monthIndex < months; monthIndex += 1) {
		const bucketDate = addMonths(fromDate, monthIndex);
		const bucketRange = createReportDateRange({
			dateFrom: format(startOfMonth(bucketDate), "yyyy-MM-dd"),
			dateTo: format(endOfMonth(bucketDate), "yyyy-MM-dd"),
		});
		const snapshot = buildSnapshot(context, bucketRange);
		const lines = filterLinesByScope(snapshot.realizedLines, scope);
		const failedBatchLosses = filterFailedBatchLossesByScope(
			context.failedProductionLosses.filter(
				(loss) =>
					loss.settledAt >= bucketRange.fromDate &&
					loss.settledAt <= bucketRange.toDate,
			),
			scope,
		).reduce((sum, loss) => sum + loss.lossAmount, 0);

		trend.push({
			monthKey: format(bucketDate, "yyyy-MM-01"),
			monthLabel: format(bucketDate, "MMM yyyy"),
			...metricsFromLines(lines, failedBatchLosses),
		});
	}

	return trend;
}

export async function fetchProductRecipeBreakdown(
	productId: string,
	range: ReportDateRange,
): Promise<RecipeBreakdownRow[]> {
	const [productRecipes, context] = await Promise.all([
		db.query.recipes.findMany({
			where: eq(recipes.productId, productId),
			columns: {
				id: true,
				name: true,
				fillAmount: true,
				fillUnit: true,
			},
		}),
		loadContext(range.fromDate, range.toDate),
	]);

	const snapshot = buildSnapshot(context, range);
	const variantLabelById = new Map(
		productRecipes.map((recipe) => [
			recipe.id,
			buildVariantLabel(recipe.fillAmount, recipe.fillUnit),
		]),
	);

	const aggregatesByRecipe = new Map<
		string,
		{
			revenue: number;
			cogs: number;
			units: number;
			cartons: number;
			invoiceCount: number;
		}
	>();

	for (const line of snapshot.realizedLines) {
		if (
			line.productId !== productId ||
			!line.recipeId ||
			(!hasMeaningfulValue(line.realizedRevenue) &&
				!hasMeaningfulValue(line.realizedCogs) &&
				!hasMeaningfulValue(line.realizedUnits))
		) {
			continue;
		}

		const existing = aggregatesByRecipe.get(line.recipeId) ?? {
			revenue: 0,
			cogs: 0,
			units: 0,
			cartons: 0,
			invoiceCount: 0,
		};
		existing.revenue += line.realizedRevenue;
		existing.cogs += line.realizedCogs;
		existing.units += line.realizedUnits;
		existing.cartons += line.realizedCartons;
		aggregatesByRecipe.set(line.recipeId, existing);
	}

	const invoiceIdsByRecipe = new Map<string, Set<string>>();
	const failedBatchLossByRecipe = new Map<string, number>();
	for (const line of snapshot.realizedLines) {
		if (
			line.productId !== productId ||
			!line.recipeId ||
			(!hasMeaningfulValue(line.realizedRevenue) &&
				!hasMeaningfulValue(line.realizedCogs) &&
				!hasMeaningfulValue(line.realizedUnits))
		) {
			continue;
		}
		const bucket = invoiceIdsByRecipe.get(line.recipeId) ?? new Set<string>();
		bucket.add(line.invoiceId);
		invoiceIdsByRecipe.set(line.recipeId, bucket);
	}

	for (const loss of filterFailedBatchLossesByScope(
		context.failedProductionLosses,
		{ productId },
	)) {
		failedBatchLossByRecipe.set(
			loss.recipeId,
			(failedBatchLossByRecipe.get(loss.recipeId) ?? 0) + loss.lossAmount,
		);
	}

	return productRecipes
		.map((recipe) => {
			const aggregate = aggregatesByRecipe.get(recipe.id);
			const invoiceCount = invoiceIdsByRecipe.get(recipe.id)?.size ?? 0;
			const failedBatchLosses = roundCurrency(
				failedBatchLossByRecipe.get(recipe.id) ?? 0,
			);
			const metrics = calculateMetrics({
				totalRevenue: aggregate ? roundCurrency(aggregate.revenue) : 0,
				totalCogs: aggregate ? roundCurrency(aggregate.cogs) : 0,
				soldUnits: aggregate ? roundMetric(aggregate.units) : 0,
				invoiceCount,
				failedBatchLosses,
			});

			return {
				recipeId: recipe.id,
				recipeName: recipe.name,
				variantLabel: variantLabelById.get(recipe.id) ?? null,
				recipeCode: null,
				realizedCartons: aggregate ? roundMetric(aggregate.cartons) : 0,
				...metrics,
			} satisfies RecipeBreakdownRow;
		})
		.sort((left, right) => right.totalRevenue - left.totalRevenue);
}

export async function fetchScopedFailedBatchLosses(
	scope: Pick<ScopeFilter, "productId" | "recipeId">,
	range: ReportDateRange,
): Promise<ScopedFailedBatchLossRow[]> {
	const context = await loadContext(range.fromDate, range.toDate);

	return filterFailedBatchLossesByScope(context.failedProductionLosses, scope)
		.sort((left, right) => right.settledAt.getTime() - left.settledAt.getTime())
		.map((loss) => ({
			settlementId: loss.id,
			productionRunId: loss.productionRunId,
			batchId: loss.batchId,
			settledAt: loss.settledAt.toISOString(),
			recipeId: loss.recipeId,
			recipeName: loss.recipeName,
			productId: loss.productId,
			productName: loss.productName,
			chemicalId: loss.chemicalId,
			chemicalName: loss.chemicalName,
			expectedQuantity: loss.expectedQuantity,
			recoveredQuantity: loss.recoveredQuantity,
			lossQuantity: loss.lossQuantity,
			costPerUnit: loss.costPerUnit,
			lossAmount: loss.lossAmount,
		}));
}

export async function fetchProductRecentInvoices(
	productId: string,
	range: ReportDateRange,
	limit = 12,
): Promise<RealizedInvoiceRow[]> {
	const rows = await fetchScopedInvoiceRows({ productId }, range);
	return rows.slice(0, limit);
}

export async function fetchRecipeInvoiceDetails(
	recipeId: string,
	range: ReportDateRange,
): Promise<RealizedInvoiceRow[]> {
	return fetchScopedInvoiceRows({ recipeId }, range);
}

export function snapshotRecipeRollup(
	snapshot: CompanySnapshot,
	productId: string,
): PnlMetrics {
	const lines = snapshot.realizedLines.filter(
		(line) => line.productId === productId,
	);
	return metricsFromLines(lines);
}
