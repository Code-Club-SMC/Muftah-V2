import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import {
	ArrowLeft,
	Briefcase,
	Clock,
	DollarSign,
	Package,
	Percent,
	ShoppingCart,
	Tag,
	TrendingUp,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	MarginTrendChart,
	PnlTrendChart,
	ProfitabilityChart,
	RevenueCostSnapshotChart,
} from "@/components/reports/profit-loss/pnl-charts";
import { PnlLoadingSkeleton } from "@/components/reports/profit-loss/pnl-loading-skeleton";
import {
	type BreadcrumbItem,
	PnlBreakdownTable,
	PnlEmptyState,
	PnlKpiCard,
	PnlMetricTileRow,
	PnlPageHeader,
	PnlPrintFooter,
	PnlPrintHeader,
	PnlPrintStyles,
	PnlScopedStatusCard,
	PnlSectionCard,
	PnlStatusBadge,
} from "@/components/reports/profit-loss/pnl-report-primitives";
import { PnlTerminologyDialog } from "@/components/reports/profit-loss/pnl-terminology-dialog";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPKR, formatPKRPrecise } from "@/lib/currency-format";
import { cn } from "@/lib/utils";
import {
	getRecipeProfitLossFn,
	type RecipeProfitLossResult,
} from "@/server-functions/reports/profit-loss/recipe-pnl-fn";

const today = new Date();
const defaultFrom = format(startOfMonth(today), "yyyy-MM-dd");
const defaultTo = format(endOfMonth(today), "yyyy-MM-dd");

function searchToRange(from: string, to: string): DateRange {
	return {
		from: parseISO(from),
		to: parseISO(to),
	};
}

export const Route = createFileRoute(
	"/_protected/reports/profit-loss/recipe/$recipeId/",
)({
	validateSearch: (search: Record<string, unknown>) => ({
		from: String(search.from ?? defaultFrom),
		to: String(search.to ?? defaultTo),
	}),
	component: RecipeProfitLossReportPage,
});

function RecipeProfitLossReportPage() {
	const { recipeId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const [dateRange, setDateRange] = useState<DateRange | undefined>(
		searchToRange(search.from, search.to),
	);

	useEffect(() => {
		setDateRange(searchToRange(search.from, search.to));
	}, [search.from, search.to]);

	const { data, isLoading, isError, error, isFetching } =
		useQuery<RecipeProfitLossResult>({
			queryKey: [
				"reports",
				"profit-loss",
				"recipe",
				recipeId,
				search.from,
				search.to,
			],
			queryFn: () =>
				getRecipeProfitLossFn({
					data: {
						recipeId,
						dateFrom: search.from,
						dateTo: search.to,
					},
				}),
		});
	const impactTrendData =
		data?.monthlyTrend.map((point) => ({
			...point,
			netProfit: point.netImpact,
			netMarginPercent: point.netImpactMarginPercent,
		})) ?? [];

	const handleApply = () => {
		if (!dateRange?.from || !dateRange.to) {
			return;
		}

		startTransition(() => {
			navigate({
				to: "/reports/profit-loss/recipe/$recipeId",
				params: { recipeId },
				search: {
					from: format(dateRange.from!, "yyyy-MM-dd"),
					to: format(dateRange.to!, "yyyy-MM-dd"),
				},
			});
		});
	};

	const handlePrint = () => {
		window.print();
	};

	const breadcrumbs: BreadcrumbItem[] = data
		? [
				{ label: "Products", to: "/manufacturing/recipes" },
				{
					label: data.recipe.product.name,
					to: "/reports/profit-loss/product/$productId",
					params: { productId: data.recipe.product.id },
					search: { from: search.from, to: search.to },
				},
				{ label: data.recipe.name },
				{ label: "P&L Report" },
			]
		: [
				{ label: "Products", to: "/manufacturing/recipes" },
				{ label: "P&L Report" },
			];

	if (isError) {
		return (
			<main data-pnl-report className="space-y-6">
				<PnlPrintStyles />
				<PnlEmptyState
					title="Unable to load Recipe P&L"
					description={error instanceof Error ? error.message : "Unknown error"}
				/>
			</main>
		);
	}

	return (
		<main data-pnl-report className="space-y-6 pb-8">
			<PnlPrintStyles />

			{data ? (
				<PnlPrintHeader
					title="Recipe P&L Report"
					productName={data.recipe.product.name}
					recipeName={data.recipe.name}
					recipeCode={data.recipe.recipeCode}
					periodLabel={data.reportPeriod.label}
					generatedAt={data.generatedAt}
				/>
			) : null}

			<div className="print-hidden">
				<PnlPageHeader
					breadcrumbs={breadcrumbs}
					title={`${data?.recipe.name ?? "Recipe"} - P&L Report`}
					subtitle="Recipe-level profitability using realized revenue and actual sold cost only. No company-wide overhead is allocated here."
					meta={[
						{ label: "Product", value: data?.recipe.product.name },
						{
							label: "Recipe Code",
							value: data?.recipe.recipeCode ?? "Not assigned",
						},
					]}
					periodLabel={
						data?.reportPeriod.label ?? `${search.from} - ${search.to}`
					}
					dateRange={dateRange}
					onDateRangeChange={setDateRange}
					onApply={handleApply}
					isPending={isFetching}
					exportProps={{
						dateFrom: search.from,
						dateTo: search.to,
						recipeId,
						reportTitle: data ? `recipe-pnl-${data.recipe.name}` : "recipe-pnl",
					}}
					onPrint={handlePrint}
					identityLabel={data?.recipe.name ?? "Recipe"}
					extraAction={
						<div className="flex items-center gap-2">
							<PnlTerminologyDialog />
							{data ? (
								<Link
									to="/reports/profit-loss/product/$productId"
									params={{ productId: data.recipe.product.id }}
									search={{ from: search.from, to: search.to }}
									className="inline-flex"
								>
									<Button variant="outline" size="sm">
										<ArrowLeft className="size-4" />
										Back to Product Overview
									</Button>
								</Link>
							) : null}
						</div>
					}
				/>
			</div>

			{isLoading && !data ? <PnlLoadingSkeleton /> : null}

			{data ? (
				<>
					<div className="space-y-6">
						<PnlScopedStatusCard
							status={data.status}
							directProfit={data.summary.netProfit}
							statusAmount={data.summary.netImpact}
							collectedRevenue={data.summary.totalRevenue}
							costOfGoodsSold={data.summary.totalCogs}
							failedBatchLosses={data.summary.failedBatchLosses}
							realizedUnits={data.summary.soldUnits}
							invoiceCount={data.summary.invoiceCount}
						/>

						<section className="grid gap-4 grid-cols-2 md:grid-cols-4">
							<PnlKpiCard
								label="Collected Revenue"
								value={formatPKR(data.summary.totalRevenue, false)}
								delta={data.kpis.totalRevenueDeltaPercent}
								deltaLabel={data.comparisonLabel}
								icon={<DollarSign className="size-5" />}
								iconClassName="bg-blue-100 text-blue-600"
							/>
							<PnlKpiCard
								label="Total COGS"
								value={formatPKR(data.summary.totalCogs, false)}
								delta={data.kpis.totalCogsDeltaPercent}
								deltaLabel={data.comparisonLabel}
								icon={<ShoppingCart className="size-5" />}
								iconClassName="bg-rose-100 text-rose-600"
							/>
							<PnlKpiCard
								label="Gross Profit"
								value={formatPKR(data.summary.grossProfit, false)}
								delta={data.kpis.grossProfitDeltaPercent}
								deltaLabel={data.comparisonLabel}
								icon={<TrendingUp className="size-5" />}
								iconClassName="bg-emerald-100 text-emerald-600"
							/>
							<PnlKpiCard
								label="Gross Margin"
								value={`${data.summary.grossMarginPercent.toFixed(2)}%`}
								delta={data.kpis.grossMarginDeltaPoints}
								deltaLabel={data.comparisonLabel}
								deltaKind="points"
								icon={<Percent className="size-5" />}
								iconClassName="bg-violet-100 text-violet-600"
							/>
							<PnlKpiCard
								label="Direct Profit"
								value={formatPKR(data.summary.netProfit, false)}
								delta={data.kpis.directProfitDeltaPercent}
								deltaLabel={data.comparisonLabel}
								icon={<Briefcase className="size-5" />}
								iconClassName="bg-orange-100 text-orange-600"
							/>
							<PnlKpiCard
								label="Direct Margin"
								value={`${data.summary.netMarginPercent.toFixed(2)}%`}
								delta={data.kpis.directMarginDeltaPoints}
								deltaLabel={data.comparisonLabel}
								deltaKind="points"
								icon={<Clock className="size-5" />}
								iconClassName="bg-blue-100 text-blue-600"
							/>
							<PnlKpiCard
								label="Failed Batch Loss"
								value={formatPKR(data.summary.failedBatchLosses, false)}
								delta={data.kpis.failedBatchLossesDeltaPercent}
								deltaLabel={data.comparisonLabel}
								icon={<Package className="size-5" />}
								iconClassName="bg-amber-100 text-amber-700"
							/>
							<PnlKpiCard
								label="Net Impact"
								value={formatPKR(data.summary.netImpact, false)}
								delta={data.kpis.netImpactDeltaPercent}
								deltaLabel={data.comparisonLabel}
								icon={<TrendingUp className="size-5" />}
								iconClassName="bg-violet-100 text-violet-600"
							/>
						</section>
					</div>

					<div className="grid gap-6 xl:grid-cols-2">
						<PnlSectionCard
							title="P&L Trend (Last 6 Months)"
							description="Selected-period direct profitability with a six-month trend context ending on the current report period."
							info
						>
							<PnlTrendChart data={data.monthlyTrend} profitLabel="Direct Profit" />
						</PnlSectionCard>

						<PnlSectionCard
							title="Recipe P&L Breakdown"
							description="Realized revenue, actual sold cost, direct profit, failed-batch loss, and final net impact for this recipe."
							info
						>
							<PnlBreakdownTable summary={data.summary} />
						</PnlSectionCard>
					</div>

					<div className="grid gap-6 xl:grid-cols-3">
						<PnlSectionCard
							title="Margin Trend"
							description="Gross margin versus final impact margin after failed-batch chemical losses."
							info
						>
							<MarginTrendChart
								data={impactTrendData}
								marginLabel="Impact Margin"
							/>
						</PnlSectionCard>

						<PnlSectionCard
							title="Revenue vs Cost"
							description="Current-period comparison between revenue, total COGS, gross profit, and final net impact."
							info
						>
							<RevenueCostSnapshotChart
								revenue={data.summary.totalRevenue}
								totalCogs={data.summary.totalCogs}
								grossProfit={data.summary.grossProfit}
								netProfit={data.summary.netImpact}
								profitLabel="Net Impact"
							/>
						</PnlSectionCard>

						<PnlSectionCard
							title="Monthly Profitability"
							description="Monthly gross profitability versus final net impact after failed-batch losses."
							info
						>
							<ProfitabilityChart
								data={impactTrendData}
								profitLabel="Net Impact"
							/>
						</PnlSectionCard>
					</div>

					<div className="grid gap-6 xl:grid-cols-[2fr,3fr]">
						<PnlSectionCard
							title="Unit Economics"
							description="Per-unit economics based on sold units in the selected reporting period."
							info
						>
							<PnlMetricTileRow
								items={[
									{
										label: "Sales Quantity",
										value: `${formatNumber(data.summary.soldUnits)} Units`,
										delta: data.kpis.soldUnitsDeltaPercent,
										deltaLabel: data.comparisonLabel,
										icon: <Package className="size-3.5" />,
										iconClassName: "text-blue-600",
									},
									{
										label: "Avg. Selling Price",
										value: `${formatPKRPrecise(data.summary.averageSellingPricePerUnit)} / Unit`,
										delta: data.kpis.averageSellingPricePerUnitDeltaPercent,
										deltaLabel: data.comparisonLabel,
										icon: <Tag className="size-3.5" />,
										iconClassName: "text-emerald-600",
									},
									{
										label: "Realized COGS per Sold Unit",
										value: `${formatPKRPrecise(data.summary.cogsPerUnit)} / Unit`,
										description:
											"Average invoice-line COGS for units sold in this period. This is based on realized sold units, not the current inventory WAC of stock still on hand.",
										delta: data.kpis.cogsPerUnitDeltaPercent,
										deltaLabel: data.comparisonLabel,
										icon: <ShoppingCart className="size-3.5" />,
										iconClassName: "text-rose-600",
									},
									...(data.currentInventoryWacPerPack !== null
										? [
												{
													label: "Current Inventory WAC / Pack",
													value: `${formatPKRPrecise(data.currentInventoryWacPerPack)} / Pack`,
													description:
														"Current weighted average cost of the remaining stock in the factory floor warehouse. This is a live inventory value and can differ from sold-period COGS.",
													icon: <Package className="size-3.5" />,
													iconClassName: "text-amber-600",
												},
											]
										: []),
									{
										label: "Gross Profit per Unit",
										value: `${formatPKRPrecise(data.summary.grossProfitPerUnit)} / Unit`,
										delta: data.kpis.grossProfitPerUnitDeltaPercent,
										deltaLabel: data.comparisonLabel,
										icon: <TrendingUp className="size-3.5" />,
										iconClassName: "text-emerald-600",
									},
									{
										label: "Direct Profit per Unit",
										value: `${formatPKRPrecise(data.summary.netProfitPerUnit)} / Unit`,
										delta: data.kpis.directProfitPerUnitDeltaPercent,
										deltaLabel: data.comparisonLabel,
										icon: <Briefcase className="size-3.5" />,
										iconClassName: "text-orange-600",
									},
									{
										label: "Net Impact per Unit",
										value: `${formatPKRPrecise(data.summary.netImpactPerUnit)} / Unit`,
										delta: data.kpis.netImpactPerUnitDeltaPercent,
										deltaLabel: data.comparisonLabel,
										icon: <TrendingUp className="size-3.5" />,
										iconClassName: "text-violet-600",
									},
								]}
							/>
						</PnlSectionCard>

						<PnlSectionCard
							title="Invoice Drill-down"
							description="Every invoice line that explains this recipe's realized revenue, actual sold cost, and direct profit for the selected period."
							info
						>
							{data.invoiceDetails.length === 0 ? (
								<PnlEmptyState
									title="No invoice activity"
									description="No realized invoice lines were found for this recipe in the selected date range."
								/>
							) : (
								<div
									data-pnl-table
									className="overflow-hidden rounded-xl border border-border"
								>
									<Table>
										<TableHeader>
											<TableRow className="bg-slate-50 hover:bg-slate-50">
												<TableHead className="font-semibold text-foreground">
													Invoice No.
												</TableHead>
												<TableHead className="font-semibold text-foreground">
													Date
												</TableHead>
												<TableHead className="font-semibold text-foreground">
													Customer
												</TableHead>
												<TableHead className="font-semibold text-foreground">
													Pack
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Realized Qty
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Realized Revenue
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Realized COGS
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Direct Profit
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Realization %
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Status
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{data.invoiceDetails.map((invoice) => (
												<TableRow key={`${invoice.invoiceId}-${invoice.pack}`}>
													<TableCell className="font-medium text-foreground">
														{invoice.invoiceNumber ?? invoice.invoiceId}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{format(
															parseISO(invoice.invoiceDate),
															"dd MMM yyyy",
														)}
													</TableCell>
													<TableCell>{invoice.customerName}</TableCell>
													<TableCell className="text-muted-foreground">
														{invoice.pack || "-"}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{formatNumber(invoice.realizedUnits)}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{formatPKR(invoice.realizedRevenue, false)}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{formatPKR(invoice.realizedCogs, false)}
													</TableCell>
													<TableCell
														className={cn(
															"text-right font-mono tabular-nums",
															invoice.realizedProfit < 0
																? "text-rose-600"
																: "text-foreground",
														)}
													>
														{formatPKR(invoice.realizedProfit, false)}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{(invoice.realizedRatio * 100).toFixed(1)}%
													</TableCell>
													<TableCell className="text-right">
														<PnlStatusBadge status={invoice.invoiceStatus} />
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</PnlSectionCard>
					</div>

					<PnlSectionCard
						title="Failed Batch Loss Trace"
						description="Every zero-output failed batch chemical loss posted against this recipe in the selected period."
						info
					>
						{data.failedBatchLosses.length === 0 ? (
							<PnlEmptyState
								title="No failed batch losses"
								description="No unrecovered failed-batch chemical losses were posted against this recipe in the selected date range."
							/>
						) : (
							<div
								data-pnl-table
								className="overflow-hidden rounded-xl border border-border"
							>
								<Table>
									<TableHeader>
										<TableRow className="bg-slate-50 hover:bg-slate-50">
											<TableHead className="font-semibold text-foreground">
												Batch
											</TableHead>
											<TableHead className="font-semibold text-foreground">
												Date
											</TableHead>
											<TableHead className="font-semibold text-foreground">
												Chemical
											</TableHead>
											<TableHead className="text-right font-semibold text-foreground">
												Expected
											</TableHead>
											<TableHead className="text-right font-semibold text-foreground">
												Recovered
											</TableHead>
											<TableHead className="text-right font-semibold text-foreground">
												Lost
											</TableHead>
											<TableHead className="text-right font-semibold text-foreground">
												Loss Amount
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.failedBatchLosses.map((loss) => (
											<TableRow key={loss.settlementId}>
												<TableCell className="font-medium text-foreground">
													{loss.batchId}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{format(parseISO(loss.settledAt), "dd MMM yyyy")}
												</TableCell>
												<TableCell>{loss.chemicalName}</TableCell>
												<TableCell className="text-right font-mono tabular-nums">
													{formatNumber(loss.expectedQuantity)}
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums text-emerald-600">
													{formatNumber(loss.recoveredQuantity)}
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums text-rose-600">
													{formatNumber(loss.lossQuantity)}
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums text-rose-600">
													{formatPKR(loss.lossAmount, false)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</PnlSectionCard>

					<PnlPrintFooter generatedAt={data.generatedAt} />
				</>
			) : null}
		</main>
	);
}
