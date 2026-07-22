import { clampRatio } from "./reporting-math";

export interface AggregatableRealizedLine {
	invoiceId: string;
	invoiceDate: Date;
	slipNumber: string | null;
	customerName: string;
	invoiceStatus: string;
	recipeId: string | null;
	recipeName: string | null;
	pack: string;
	realizedRevenue: number;
	realizedCogs: number;
	realizedCartons: number;
	realizedUnits: number;
	realizedRatio: number;
	paymentToDate: number;
	adjustedLineRevenue: number;
	adjustedLineCogs: number;
}

export interface AggregatedRealizedInvoiceRow {
	invoiceId: string;
	invoiceNumber: string | null;
	invoiceDate: string;
	customerName: string;
	invoiceStatus: string;
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
}

function roundCurrency(value: number): number {
	return Number(value.toFixed(2));
}

function roundMetric(value: number): number {
	return Number(value.toFixed(4));
}

export function aggregateRealizedInvoiceRows<
	T extends AggregatableRealizedLine,
>(
	lines: T[],
	variantLabelMap: Map<string, string | null>,
): AggregatedRealizedInvoiceRow[] {
	const groups = new Map<string, T[]>();

	for (const line of lines) {
		const key = `${line.invoiceId}|${line.recipeId ?? "unmapped"}|${line.pack}`;
		const bucket = groups.get(key);
		if (bucket) {
			bucket.push(line);
		} else {
			groups.set(key, [line]);
		}
	}

	return Array.from(groups.values()).map((group) => {
		const first = group[0];
		const totalAdjustedRevenue = group.reduce(
			(sum, line) => sum + line.adjustedLineRevenue,
			0,
		);
		const totalAdjustedCogs = group.reduce(
			(sum, line) => sum + line.adjustedLineCogs,
			0,
		);
		const totalRealizedRevenue = group.reduce(
			(sum, line) => sum + line.realizedRevenue,
			0,
		);
		const totalRealizedCogs = group.reduce(
			(sum, line) => sum + line.realizedCogs,
			0,
		);
		const totalRealizedUnits = group.reduce(
			(sum, line) => sum + line.realizedUnits,
			0,
		);
		const totalRealizedCartons = group.reduce(
			(sum, line) => sum + line.realizedCartons,
			0,
		);

		return {
			invoiceId: first.invoiceId,
			invoiceNumber: first.slipNumber,
			invoiceDate: first.invoiceDate.toISOString(),
			customerName: first.customerName,
			invoiceStatus: first.invoiceStatus,
			recipeId: first.recipeId,
			recipeName: first.recipeName,
			variantLabel: first.recipeId
				? (variantLabelMap.get(first.recipeId) ?? null)
				: null,
			pack: first.pack,
			realizedRevenue: roundCurrency(totalRealizedRevenue),
			realizedCogs: roundCurrency(totalRealizedCogs),
			realizedProfit: roundCurrency(totalRealizedRevenue - totalRealizedCogs),
			realizedUnits: roundMetric(totalRealizedUnits),
			realizedCartons: roundMetric(totalRealizedCartons),
			realizedRatio:
				totalAdjustedRevenue > 0
					? clampRatio(totalRealizedRevenue / totalAdjustedRevenue)
					: first.realizedRatio,
			paymentToDate: first.paymentToDate,
			adjustedLineRevenue: roundCurrency(totalAdjustedRevenue),
			adjustedLineCogs: roundCurrency(totalAdjustedCogs),
		};
	});
}
