import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import {
	ArrowRight,
	Clock,
	DollarSign,
	Package,
	Percent,
	PieChart,
	ShoppingBasket,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	PnlTrendChart,
	ProfitabilityChart,
	RevenueCostSnapshotChart,
	TopGrossProfitBar,
} from "@/components/reports/profit-loss/pnl-charts";
import { PnlLoadingSkeleton } from "@/components/reports/profit-loss/pnl-loading-skeleton";
import {
	type BreadcrumbItem,
	PnlBreakdownTable,
	PnlEmptyState,
	PnlKpiCard,
	PnlPageHeader,
	PnlPrintHeader,
	PnlPrintStyles,
	PnlScopedStatusCard,
	PnlSectionCard,
	PnlStatusBadge,
} from "@/components/reports/profit-loss/pnl-report-primitives";
import { PnlTerminologyDialog } from "@/components/reports/profit-loss/pnl-terminology-dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPKR } from "@/lib/currency-format";
import { cn } from "@/lib/utils";
import {
	getProductProfitLossForReportsFn,
	type ProductProfitLossForReportsResult,
} from "@/server-functions/reports/profit-loss/product-pnl-for-reports-fn";

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
	"/_protected/reports/profit-loss/product/$productId/",
)({
	validateSearch: (search: Record<string, unknown>) => ({
		from: String(search.from ?? defaultFrom),
		to: String(search.to ?? defaultTo),
	}),
	component: ProductProfitLossReportPage,
});

function ProductProfitLossReportPage() {
	const { productId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const [dateRange, setDateRange] = useState<DateRange | undefined>(
		searchToRange(search.from, search.to),
	);

	useEffect(() => {
		setDateRange(searchToRange(search.from, search.to));
	}, [search.from, search.to]);

	const { data, isLoading, isError, error, isFetching } =
		useQuery<ProductProfitLossForReportsResult>({
			queryKey: [
				"reports",
				"profit-loss",
				"product",
				productId,
				search.from,
				search.to,
			],
			queryFn: () =>
				getProductProfitLossForReportsFn({
					data: {
						productId,
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
	const recipeImpactChartData =
		data?.recipes.map((recipe) => ({
			name: recipe.recipeName,
			value: recipe.netImpact,
		})) ?? [];

	const handleApply = () => {
		if (!dateRange?.from || !dateRange.to) {
			return;
		}

		startTransition(() => {
			navigate({
				to: "/reports/profit-loss/product/$productId",
				params: { productId },
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
				{ label: data.product.name },
				{ label: "P&L Overview" },
			]
		: [
				{ label: "Products", to: "/manufacturing/recipes" },
				{ label: "P&L Overview" },
			];

	if (isError) {
		return (
			<main data-pnl-report className="space-y-6">
				<PnlPrintStyles />
				<PnlEmptyState
					title="Unable to load Product P&L"
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
					title="Product P&L Overview"
					productName={data.product.name}
					productCode={data.product.productCode}
					category={data.product.category}
					periodLabel={data.reportPeriod.label}
					generatedAt={data.generatedAt}
				/>
			) : null}

			<div className="print-hidden">
				<PnlPageHeader
					breadcrumbs={breadcrumbs}
					title={`${data?.product.name ?? "Product"} - Product P&L Overview`}
					subtitle={
						data?.product.description ??
						"Product-level profitability with recipe drill-down and recent invoice visibility."
					}
					metaBadges={[
						{
							icon: <Clock className="size-3.5" />,
							text: `Reporting Period: ${data?.reportPeriod.label ?? `${search.from} - ${search.to}`}`,
						},
						{
							icon: <Package className="size-3.5" />,
							text: `Product: ${data?.product.name ?? "Product"}`,
						},
					]}
					periodLabel={
						data?.reportPeriod.label ?? `${search.from} - ${search.to}`
					}
					showPeriodBadge={false}
					dateRange={dateRange}
					onDateRangeChange={setDateRange}
					onApply={handleApply}
					isPending={isFetching}
					exportProps={{
						dateFrom: search.from,
						dateTo: search.to,
						productId,
						reportTitle: data
							? `product-pnl-${data.product.name}`
							: "product-pnl",
					}}
					onPrint={handlePrint}
					identityLabel={data?.product.name ?? "Product"}
					secondaryActions={<PnlTerminologyDialog />}
				/>
			</div>

			{isLoading && !data ? <PnlLoadingSkeleton /> : null}

			{data ? (
				<>
					<PnlScopedStatusCard
						status={data.status}
						directProfit={data.summary.netProfit}
						statusAmount={data.summary.netImpact}
						collectedRevenue={data.summary.totalRevenue}
						costOfGoodsSold={data.summary.totalCogs}
						failedBatchLosses={data.summary.failedBatchLosses}
						realizedUnits={data.summary.soldUnits}
						invoiceCount={data.summary.invoiceCount}
						inlineLabelUppercase
					/>

					<section className="grid gap-4 grid-cols-2 md:grid-cols-4">
						<PnlKpiCard
							label="Collected Revenue"
							value={formatPKR(data.summary.totalRevenue, false)}
							delta={data.kpis.totalRevenueDeltaPercent}
							deltaLabel={data.comparisonLabel}
							icon={<DollarSign className="size-5" />}
							iconClassName="bg-blue-100 text-blue-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Total COGS"
							value={formatPKR(data.summary.totalCogs, false)}
							delta={data.kpis.totalCogsDeltaPercent}
							deltaLabel={data.comparisonLabel}
							icon={<ShoppingBasket className="size-5" />}
							iconClassName="bg-rose-100 text-rose-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Gross Profit"
							value={formatPKR(data.summary.grossProfit, false)}
							delta={data.kpis.grossProfitDeltaPercent}
							deltaLabel={data.comparisonLabel}
							icon={<TrendingUp className="size-5" />}
							iconClassName="bg-emerald-100 text-emerald-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Gross Margin"
							value={`${data.summary.grossMarginPercent.toFixed(2)}%`}
							delta={data.kpis.grossMarginDeltaPoints}
							deltaLabel={data.comparisonLabel}
							deltaKind="points"
							icon={<Percent className="size-5" />}
							iconClassName="bg-violet-100 text-violet-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Direct Profit"
							value={formatPKR(data.summary.netProfit, false)}
							delta={data.kpis.directProfitDeltaPercent}
							deltaLabel={data.comparisonLabel}
							icon={<Wallet className="size-5" />}
							iconClassName="bg-orange-100 text-orange-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Direct Margin"
							value={`${data.summary.netMarginPercent.toFixed(2)}%`}
							delta={data.kpis.directMarginDeltaPoints}
							deltaLabel={data.comparisonLabel}
							deltaKind="points"
							icon={<PieChart className="size-5" />}
							iconClassName="bg-blue-100 text-blue-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Failed Batch Loss"
							value={formatPKR(data.summary.failedBatchLosses, false)}
							delta={data.kpis.failedBatchLossesDeltaPercent}
							deltaLabel={data.comparisonLabel}
							icon={<Package className="size-5" />}
							iconClassName="bg-amber-100 text-amber-700"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
						<PnlKpiCard
							label="Net Impact"
							value={formatPKR(data.summary.netImpact, false)}
							delta={data.kpis.netImpactDeltaPercent}
							deltaLabel={data.comparisonLabel}
							icon={<Wallet className="size-5" />}
							iconClassName="bg-violet-100 text-violet-600"
							labelClassName="text-[10px] font-semibold uppercase tracking-wide"
							showTrendBadge
						/>
					</section>

					<div className="grid gap-6 xl:grid-cols-3">
						<PnlSectionCard
							title="P&L Trend (Last 6 Months)"
							description="Revenue, COGS, gross profit, and direct profit across the last six months ending on the selected report period."
							info
						>
							<PnlTrendChart data={data.monthlyTrend} profitLabel="Direct Profit" />
						</PnlSectionCard>

						<PnlSectionCard
							title="Revenue vs Cost Snapshot"
							description="Selected-period snapshot across revenue, COGS, gross profit, and final net impact after failed-batch losses."
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
							title="Net Impact by Recipe"
							description="Recipe comparison after realized sales, actual sold cost, and failed-batch chemical losses."
							info
						>
							{data.recipes.length > 0 ? (
								<TopGrossProfitBar
									data={recipeImpactChartData}
									metricLabel="Net Impact"
									color="#2563eb"
									showValueLabel={false}
								/>
							) : (
								<PnlEmptyState
									title="No recipe profitability"
									description="Recipe comparisons will appear here once invoice activity exists for at least one recipe."
								/>
							)}
						</PnlSectionCard>
					</div>

					<div className="grid gap-6 xl:grid-cols-[5fr,6fr]">
						<PnlSectionCard
							title={`Recipes under ${data.product.name}`}
							description="Use this table as the drill-down entry point into the specific recipe P&L report."
							info
						>
							{data.recipes.length === 0 ? (
								<PnlEmptyState
									title="No recipes under this product"
									description="Create a recipe for this product before detailed P&L analysis can be generated."
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
													Recipe
												</TableHead>
												<TableHead className="font-semibold text-foreground">
													Package / Variant
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Revenue
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Gross Profit
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Gross Margin
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Direct Profit
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Direct Margin
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Failed Batch Loss
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Net Impact
												</TableHead>
												<TableHead className="text-right font-semibold text-foreground">
													Action
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{data.recipes.map((recipe) => (
												<TableRow key={recipe.recipeId}>
													<TableCell className="font-medium text-foreground">
														{recipe.recipeName}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{recipe.variantLabel ?? "Not set"}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{formatPKR(recipe.totalRevenue, false)}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{formatPKR(recipe.grossProfit, false)}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{recipe.grossMarginPercent.toFixed(2)}%
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{formatPKR(recipe.netProfit, false)}
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums">
														{recipe.netMarginPercent.toFixed(2)}%
													</TableCell>
													<TableCell className="text-right font-mono tabular-nums text-rose-600">
														{formatPKR(recipe.failedBatchLosses, false)}
													</TableCell>
													<TableCell
														className={cn(
															"text-right font-mono tabular-nums",
															recipe.netImpact < 0
																? "text-rose-600"
																: "text-foreground",
														)}
													>
														{formatPKR(recipe.netImpact, false)}
													</TableCell>
													<TableCell className="text-right">
														<Link
															to="/reports/profit-loss/recipe/$recipeId"
															params={{ recipeId: recipe.recipeId }}
															search={{ from: search.from, to: search.to }}
															className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
														>
															View Details
															<ArrowRight className="size-4" />
														</Link>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
										<TableFooter>
											<TableRow>
												<TableCell className="font-semibold">Total</TableCell>
												<TableCell className="text-muted-foreground">
													-
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums">
													{formatPKR(data.summary.totalRevenue, false)}
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums">
													{formatPKR(data.summary.grossProfit, false)}
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums">
													{data.summary.grossMarginPercent.toFixed(2)}%
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums">
													{formatPKR(data.summary.netProfit, false)}
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums">
													{data.summary.netMarginPercent.toFixed(2)}%
												</TableCell>
												<TableCell className="text-right font-mono tabular-nums text-rose-600">
													{formatPKR(data.summary.failedBatchLosses, false)}
												</TableCell>
												<TableCell
													className={cn(
														"text-right font-mono tabular-nums",
														data.summary.netImpact < 0
															? "text-rose-600"
															: "text-foreground",
													)}
												>
													{formatPKR(data.summary.netImpact, false)}
												</TableCell>
												<TableCell className="text-right">-</TableCell>
											</TableRow>
										</TableFooter>
									</Table>
								</div>
							)}
						</PnlSectionCard>

						<PnlSectionCard
							title="Recent Invoices (All Recipes)"
							description="Realized invoice lines within the selected period across all recipes for this product. Revenue and COGS reflect only the collected portion."
							info
						>
							{data.recentInvoices.length === 0 ? (
								<PnlEmptyState
									title="No invoices in this period"
									description="No realized invoice lines were found for this product in the selected date range."
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
													Recipe / Variant
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
											{data.recentInvoices.map((invoice) => (
												<TableRow
													key={`${invoice.invoiceId}-${invoice.recipeId}-${invoice.pack}`}
												>
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
														{invoice.recipeName ?? "Unmapped"}
														{invoice.variantLabel
															? ` · ${invoice.variantLabel}`
															: ""}
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
						description="Every zero-output failed batch chemical loss attributed to this product in the selected period."
						info
					>
						{data.failedBatchLosses.length === 0 ? (
							<PnlEmptyState
								title="No failed batch losses"
								description="No unrecovered failed-batch chemical losses were posted against this product in the selected date range."
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
												Recipe
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
												<TableCell className="text-muted-foreground">
													{loss.recipeName}
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

					<div className="grid gap-6 xl:grid-cols-3">
						<PnlSectionCard
							title="P&L Breakdown"
							description="Realized revenue, actual sold cost, direct profit, failed-batch loss, and final net impact for this product."
							info
						>
							<PnlBreakdownTable summary={data.summary} />
						</PnlSectionCard>

						<PnlSectionCard
							title="Revenue by Recipe"
							description="Absolute revenue by recipe for the selected reporting period."
							info
						>
							{data.recipes.length > 0 ? (
								<TopGrossProfitBar
									data={data.recipes.map((recipe) => ({
										name: recipe.recipeName,
										value: recipe.totalRevenue,
									}))}
									metricLabel="Revenue"
									color="#2563eb"
								/>
							) : (
								<PnlEmptyState
									title="No recipes found"
									description="This product does not have any recipes attached yet."
								/>
							)}
						</PnlSectionCard>

						<PnlSectionCard
							title="Monthly Profitability"
							description="Gross profitability versus final net impact after failed-batch losses."
							info
						>
							<ProfitabilityChart data={impactTrendData} profitLabel="Net Impact" />
						</PnlSectionCard>
					</div>

					{/*<PnlPrintFooter generatedAt={data.generatedAt} />*/}
				</>
			) : null}
		</main>
	);
}
