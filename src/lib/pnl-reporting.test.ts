import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AggregatableRealizedLine } from "@/server-functions/reports/profit-loss/reporting-aggregation";
import { aggregateRealizedInvoiceRows } from "@/server-functions/reports/profit-loss/reporting-aggregation";
import {
	calculateCumulativeRealization,
	calculateDelta,
	calculateMetrics,
	calculatePeriodRealization,
	clampRatio,
	createComparisonLabel,
	createPreviousRange,
	hasMeaningfulValue,
} from "@/server-functions/reports/profit-loss/reporting-math";

const PNL_DIR = resolve(
	process.cwd(),
	"src/server-functions/reports/profit-loss",
);
const PNL_COMPONENTS_DIR = resolve(
	process.cwd(),
	"src/components/reports/profit-loss",
);
const COMPANY_ROUTE = resolve(
	process.cwd(),
	"src/routes/_protected/reports/profit-loss/index.tsx",
);
const PRODUCT_ROUTE = resolve(
	process.cwd(),
	"src/routes/_protected/reports/profit-loss/product/$productId/index.tsx",
);
const RECIPE_ROUTE = resolve(
	process.cwd(),
	"src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx",
);

describe("P&L reporting formulas", () => {
	it("calculates gross and direct profit from collected revenue and actual sold cost only", () => {
		const metrics = calculateMetrics({
			totalRevenue: 48_320_000,
			totalCogs: 31_370_000,
			soldUnits: 2_416_000,
			invoiceCount: 18,
		});

		expect(metrics.totalCogs).toBe(31_370_000);
		expect(metrics.grossProfit).toBe(16_950_000);
		expect(metrics.netProfit).toBe(metrics.grossProfit);
		expect(metrics.grossMarginPercent).toBeCloseTo(35.08, 2);
		expect(metrics.netMarginPercent).toBeCloseTo(35.08, 2);
	});

	it("guards division by zero for margins and unit metrics", () => {
		const metrics = calculateMetrics({
			totalRevenue: 0,
			totalCogs: 0,
			soldUnits: 0,
			invoiceCount: 0,
		});

		expect(metrics.grossMarginPercent).toBe(0);
		expect(metrics.netMarginPercent).toBe(0);
		expect(metrics.averageSellingPricePerUnit).toBe(0);
		expect(metrics.cogsPerUnit).toBe(0);
	});

	it("keeps failed-batch loss outside direct profit but inside scoped net impact", () => {
		const metrics = calculateMetrics({
			totalRevenue: 100_000,
			totalCogs: 60_000,
			soldUnits: 1_000,
			invoiceCount: 2,
			failedBatchLosses: 15_000,
		});

		expect(metrics.netProfit).toBe(40_000);
		expect(metrics.failedBatchLosses).toBe(15_000);
		expect(metrics.netImpact).toBe(25_000);
		expect(metrics.netImpactMarginPercent).toBe(25);
	});

	it("builds a previous comparison period with equal duration", () => {
		const current = {
			fromDate: new Date(2024, 4, 1),
			toDate: new Date(2024, 4, 31, 23, 59, 59, 999),
		};

		const previous = createPreviousRange(current);

		expect(previous.fromDate.getFullYear()).toBe(2024);
		expect(previous.fromDate.getMonth()).toBe(3);
		expect(previous.fromDate.getDate()).toBe(1);
		expect(previous.toDate.getFullYear()).toBe(2024);
		expect(previous.toDate.getMonth()).toBe(3);
		expect(previous.toDate.getDate()).toBe(30);
	});

	it("uses month labels for like-for-like monthly comparisons", () => {
		const label = createComparisonLabel(
			{
				fromDate: new Date(2024, 4, 1),
				toDate: new Date(2024, 4, 31, 23, 59, 59, 999),
			},
			{
				fromDate: new Date(2024, 3, 1),
				toDate: new Date(2024, 3, 30, 23, 59, 59, 999),
			},
		);

		expect(label).toBe("vs Apr 2024");
	});

	it("derives period realization from cumulative start/end states", () => {
		const startState = calculateCumulativeRealization({
			adjustedInvoiceTotal: 100_000,
			paymentToDate: 25_000,
			adjustedLineRevenue: 100_000,
			adjustedLineCogs: 60_000,
			adjustedCartons: 10,
			adjustedUnits: 1_000,
			invoiceExpenses: 5_000,
		});
		const endState = calculateCumulativeRealization({
			adjustedInvoiceTotal: 100_000,
			paymentToDate: 65_000,
			adjustedLineRevenue: 100_000,
			adjustedLineCogs: 60_000,
			adjustedCartons: 10,
			adjustedUnits: 1_000,
			invoiceExpenses: 5_000,
		});
		const periodState = calculatePeriodRealization(startState, endState);

		expect(periodState.realizedRevenue).toBe(40_000);
		expect(periodState.realizedCogs).toBe(24_000);
		expect(periodState.realizedInvoiceExpenses).toBe(2_000);
		expect(periodState.realizedUnits).toBe(400);
	});

	it("treats meaningful negative values as activity", () => {
		expect(hasMeaningfulValue(-0.01)).toBe(true);
		expect(hasMeaningfulValue(0.001)).toBe(false);
	});
});

describe("P&L reporting architecture", () => {
	it("routes company-wide profitability through the shared realized company reporting core", () => {
		const companySource = readFileSync(
			resolve(PNL_DIR, "company-pnl-fn.ts"),
			"utf8",
		);
		const exportSource = readFileSync(
			resolve(PNL_DIR, "export-csv-fn.ts"),
			"utf8",
		);
		const companyCoreSource = readFileSync(
			resolve(PNL_DIR, "company-reporting-core.ts"),
			"utf8",
		);

		expect(companySource).toContain("getCompanyReportData");
		expect(exportSource).toContain("getCompanyReportData");
		expect(companyCoreSource).toContain("payments");
		expect(companyCoreSource).toContain("salesReturns");
		expect(companyCoreSource).toContain("totalOperatingExpenses");
		expect(companyCoreSource).toContain("FinanceReconciliation");
	});

	it("keeps reports.view permission checks on product and recipe server functions", () => {
		const productSource = readFileSync(
			resolve(PNL_DIR, "product-pnl-for-reports-fn.ts"),
			"utf8",
		);
		const recipeSource = readFileSync(
			resolve(PNL_DIR, "recipe-pnl-fn.ts"),
			"utf8",
		);

		expect(productSource).toContain("requireReportsViewMiddleware");
		expect(recipeSource).toContain("requireReportsViewMiddleware");
		expect(recipeSource).toContain("currentInventoryWacPerPack");
		expect(recipeSource).toContain("weightedAverageCostPerPack");
	});

	it("routes product and recipe reports through the shared realized company snapshot, not recipe estimates", () => {
		const coreSource = readFileSync(
			resolve(PNL_DIR, "reporting-core.ts"),
			"utf8",
		);
		const mathSource = readFileSync(
			resolve(PNL_DIR, "reporting-math.ts"),
			"utf8",
		);

		expect(coreSource).toContain("buildSnapshot");
		expect(coreSource).toContain("loadContext");
		expect(coreSource).toContain("realizedRevenue");
		expect(coreSource).toContain("realizedCogs");
		expect(coreSource).not.toContain("estimatedIngredientsCost");
		expect(coreSource).not.toContain("estimatedPackagingCost");
		expect(coreSource).not.toContain("rawMaterialCostSql");
		expect(coreSource).not.toContain("packagingMaterialCostSql");
		expect(mathSource).toContain("grossProfit = totalRevenue - totalCogs");
		expect(mathSource).toContain("netProfit = grossProfit");
	});

	it("does not subtract non-factory expense categories in recipe and product reports", () => {
		const productSource = readFileSync(
			resolve(PNL_DIR, "product-pnl-for-reports-fn.ts"),
			"utf8",
		);
		const recipeSource = readFileSync(
			resolve(PNL_DIR, "recipe-pnl-fn.ts"),
			"utf8",
		);

		expect(productSource).not.toContain("invoiceExpenses");
		expect(productSource).not.toContain("commissions");
		expect(productSource).not.toContain("distribution");
		expect(recipeSource).not.toContain("invoiceExpenses");
		expect(recipeSource).not.toContain("commissions");
		expect(recipeSource).not.toContain("distribution");
	});
});

describe("P&L reporting UI contract", () => {
	it("keeps export CSV BOM protection for spreadsheet compatibility", () => {
		const exportBarSource = readFileSync(
			resolve(
				process.cwd(),
				"src/components/reports/profit-loss/pnl-export-bar.tsx",
			),
			"utf8",
		);

		expect(exportBarSource).toContain("\\ufeff");
	});

	it("matches the product and recipe screens to the required sections without forbidden labels", () => {
		const productRouteSource = readFileSync(PRODUCT_ROUTE, "utf8");
		const recipeRouteSource = readFileSync(RECIPE_ROUTE, "utf8");
		const costTrendSource = readFileSync(
			resolve(PNL_COMPONENTS_DIR, "cost-trend-chart.tsx"),
			"utf8",
		);

		expect(productRouteSource).toContain("Recent Invoices (All Recipes)");
		expect(productRouteSource).toContain("Recipes under");
		expect(productRouteSource).toContain("PnlScopedStatusCard");
		expect(productRouteSource).toContain("Direct Profit");
		expect(productRouteSource).toContain("Failed Batch Loss");
		expect(productRouteSource).toContain("Net Impact");
		expect(productRouteSource).toContain("Failed Batch Loss Trace");
		expect(productRouteSource).toContain("Realization %");
		expect(productRouteSource).not.toContain("Contribution");
		expect(productRouteSource).not.toContain("Cost Composition");

		expect(recipeRouteSource).toContain("Unit Economics");
		expect(recipeRouteSource).toContain("Recipe P&L Breakdown");
		expect(recipeRouteSource).toContain("Invoice Drill-down");
		expect(recipeRouteSource).toContain("PnlScopedStatusCard");
		expect(recipeRouteSource).toContain("Direct Profit");
		expect(recipeRouteSource).toContain("Failed Batch Loss");
		expect(recipeRouteSource).toContain("Net Impact");
			expect(recipeRouteSource).toContain("Failed Batch Loss Trace");
			expect(recipeRouteSource).toContain("Realized COGS per Sold Unit");
			expect(recipeRouteSource).toContain("Current Inventory WAC / Pack");
			expect(recipeRouteSource).toContain("currentInventoryWacPerPack");
			expect(recipeRouteSource).toContain("not the current inventory WAC");
			expect(recipeRouteSource).toContain("formatPKRPrecise(data.summary.cogsPerUnit)");
			expect(recipeRouteSource).toContain(
				"formatPKRPrecise(data.currentInventoryWacPerPack)",
			);
			expect(costTrendSource).toContain("formatPKRPrecise(d.avgCostPerUnit)");
		expect(recipeRouteSource).not.toContain("Contribution");
		expect(recipeRouteSource).not.toContain("Cost Composition");
	});

	it("keeps the company screen explicit about operating expenses and finance reconciliation", () => {
		const companyRouteSource = readFileSync(
			resolve(
				process.cwd(),
				"src/routes/_protected/reports/profit-loss/index.tsx",
			),
			"utf8",
		);
		const compareRoutePath = resolve(
			process.cwd(),
			"src/routes/_protected/reports/profit-loss/compare/index.tsx",
		);

		expect(companyRouteSource).toContain("Profit / Loss Status");
		expect(companyRouteSource).toContain("Operating Expenses");
		expect(companyRouteSource).toContain("Finance Reconciliation");
		expect(existsSync(compareRoutePath)).toBe(false);
	});
});

describe("P&L Phase 2 — product & recipe realized reporting", () => {
	it("uses actual invoice-line COGS and realized revenue, not recipe estimates", () => {
		const coreSource = readFileSync(
			resolve(PNL_DIR, "reporting-core.ts"),
			"utf8",
		);

		expect(coreSource).toContain("buildSnapshot");
		expect(coreSource).toContain("loadContext");
		expect(coreSource).toContain("realizedRevenue");
		expect(coreSource).toContain("realizedCogs");
		expect(coreSource).not.toContain("estimatedIngredientsCost");
		expect(coreSource).not.toContain("estimatedPackagingCost");
		expect(coreSource).not.toContain("rawMaterialCostSql");
		expect(coreSource).not.toContain("packagingMaterialCostSql");
	});

	it("exposes an explicit profit/loss/break-even/no-activity status for product and recipe scopes", () => {
		const coreSource = readFileSync(
			resolve(PNL_DIR, "reporting-core.ts"),
			"utf8",
		);
		const productSource = readFileSync(
			resolve(PNL_DIR, "product-pnl-for-reports-fn.ts"),
			"utf8",
		);
		const recipeSource = readFileSync(
			resolve(PNL_DIR, "recipe-pnl-fn.ts"),
			"utf8",
		);

		expect(coreSource).toContain("buildScopedStatus");
		expect(coreSource).toContain("no_activity");
		expect(coreSource).toContain("break_even");
		expect(productSource).toContain("buildScopedStatus");
		expect(productSource).toContain("status");
		expect(recipeSource).toContain("buildScopedStatus");
		expect(recipeSource).toContain("status");
	});

	it("gives the recipe screen an invoice drill-down dataset", () => {
		const coreSource = readFileSync(
			resolve(PNL_DIR, "reporting-core.ts"),
			"utf8",
		);
		const recipeSource = readFileSync(
			resolve(PNL_DIR, "recipe-pnl-fn.ts"),
			"utf8",
		);

		expect(coreSource).toContain("fetchRecipeInvoiceDetails");
		expect(coreSource).toContain("RealizedInvoiceRow");
		expect(recipeSource).toContain("fetchRecipeInvoiceDetails");
		expect(recipeSource).toContain("invoiceDetails");
	});

	it("derives product and recipe summaries from the same realized snapshot so they agree", () => {
		const coreSource = readFileSync(
			resolve(PNL_DIR, "reporting-core.ts"),
			"utf8",
		);

		expect(coreSource).toContain("fetchScopedSummary");
		expect(coreSource).toContain("fetchProductRecipeBreakdown");
		expect(coreSource).toContain("filterLinesByScope");
		expect(coreSource).toContain("metricsFromLines");
		expect(coreSource).toContain("filterFailedBatchLossesByScope");
		expect(coreSource).toContain("netImpact");
	});
});

describe("P&L Phase 3 — terminology dialog", () => {
	const TERMINOLOGY_FILE = resolve(
		PNL_COMPONENTS_DIR,
		"pnl-terminology-dialog.tsx",
	);

	it("ships a terminology dialog built on the shared responsive dialog wrapper", () => {
		const source = readFileSync(TERMINOLOGY_FILE, "utf8");

		expect(source).toContain("ResponsiveDialog");
		expect(source).toContain("PnlTerminologyDialog");
		expect(source).toContain("HelpCircle");
		expect(source).toContain("print:hidden");
	});

	it("defines exactly the terms that appear in the final built reports", () => {
		const source = readFileSync(TERMINOLOGY_FILE, "utf8");

		const requiredTerms = [
			"Collected Revenue",
			"Total COGS",
			"Gross Profit",
			"Gross Margin",
			"Operating Expenses",
			"Invoice Expenses",
			"Net Profit",
			"Net Margin",
			"Direct Profit",
			"Direct Margin",
			"Failed Batch Loss",
			"Net Impact",
			"Impact Margin",
			"Payroll",
			"Commissions",
			"TA/DA",
			"General Expenses",
			"Reconciliation",
		];

		for (const term of requiredTerms) {
			expect(source).toContain(`term: "${term}"`);
		}
	});

	it("surfaces the help icon near each report header without auto-opening", () => {
		const companySource = readFileSync(COMPANY_ROUTE, "utf8");
		const productSource = readFileSync(PRODUCT_ROUTE, "utf8");
		const recipeSource = readFileSync(RECIPE_ROUTE, "utf8");

		expect(companySource).toContain("PnlTerminologyDialog");
		expect(productSource).toContain("PnlTerminologyDialog");
		expect(recipeSource).toContain("PnlTerminologyDialog");

		const dialogSource = readFileSync(TERMINOLOGY_FILE, "utf8");
		expect(dialogSource).toContain("useState(false)");
		expect(dialogSource).not.toContain("useState(true)");
	});
});

describe("P&L Phase 4 — NaN / divide-by-zero guards", () => {
	it("clampRatio caps to 0..1 and converts non-finite to 0", () => {
		expect(clampRatio(0)).toBe(0);
		expect(clampRatio(0.5)).toBe(0.5);
		expect(clampRatio(1)).toBe(1);
		expect(clampRatio(1.5)).toBe(1);
		expect(clampRatio(-0.5)).toBe(0);
		expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
		expect(clampRatio(Number.NEGATIVE_INFINITY)).toBe(0);
		expect(clampRatio(Number.NaN)).toBe(0);
	});

	it("calculateMetrics never produces NaN or Infinity for zero revenue and zero units", () => {
		const metrics = calculateMetrics({
			totalRevenue: 0,
			totalCogs: 0,
			soldUnits: 0,
			invoiceCount: 0,
		});

		expect(Number.isFinite(metrics.grossMarginPercent)).toBe(true);
		expect(Number.isFinite(metrics.netMarginPercent)).toBe(true);
		expect(Number.isFinite(metrics.averageSellingPricePerUnit)).toBe(true);
		expect(Number.isFinite(metrics.cogsPerUnit)).toBe(true);
		expect(Number.isFinite(metrics.grossProfitPerUnit)).toBe(true);
		expect(Number.isFinite(metrics.netProfitPerUnit)).toBe(true);
		expect(metrics.grossMarginPercent).toBe(0);
		expect(metrics.netMarginPercent).toBe(0);
	});

	it("calculateMetrics handles positive revenue with zero sold units without NaN", () => {
		const metrics = calculateMetrics({
			totalRevenue: 100_000,
			totalCogs: 60_000,
			soldUnits: 0,
			invoiceCount: 5,
		});

		expect(Number.isFinite(metrics.averageSellingPricePerUnit)).toBe(true);
		expect(Number.isFinite(metrics.cogsPerUnit)).toBe(true);
		expect(metrics.averageSellingPricePerUnit).toBe(0);
		expect(metrics.cogsPerUnit).toBe(0);
		expect(metrics.grossProfit).toBe(40_000);
	});

	it("calculateMetrics reports a negative margin for a loss without NaN", () => {
		const metrics = calculateMetrics({
			totalRevenue: 50_000,
			totalCogs: 80_000,
			soldUnits: 1_000,
			invoiceCount: 3,
		});

		expect(Number.isFinite(metrics.grossMarginPercent)).toBe(true);
		expect(metrics.grossProfit).toBe(-30_000);
		expect(metrics.grossMarginPercent).toBe(-60);
	});

	it("calculateDelta guards against divide-by-zero and handles sign transitions", () => {
		expect(calculateDelta(0, 0)).toBe(0);
		expect(calculateDelta(100, 0)).toBe(100);
		expect(calculateDelta(0, 100)).toBe(-100);
		expect(calculateDelta(-50, 100)).toBe(-150);
		expect(calculateDelta(150, 100)).toBe(50);
	});
});

describe("P&L Phase 4 — edge-case audit on company reporting core", () => {
	const COMPANY_CORE = resolve(PNL_DIR, "company-reporting-core.ts");
	const SCOPED_CORE = resolve(PNL_DIR, "reporting-core.ts");

	function source() {
		return readFileSync(COMPANY_CORE, "utf8");
	}

	it("renders a No activity status when both revenue and expenses are zero", () => {
		const src = source();

		expect(src).toContain("no_activity");
		expect(src).toContain("No realized sales or operating expenses");
		expect(src).toContain("hasActivity");
		expect(src).toContain("hasMeaningfulValue(summary.totalRevenue)");
		expect(src).toContain("hasMeaningfulValue(summary.totalOperatingExpenses)");
	});

	it("still flags a loss when expenses exist but sales are zero", () => {
		const src = source();

		expect(src).toContain('"loss"');
		expect(src).toContain("Operating expenses exceeded realized gross profit");
		expect(src).toContain("hasMeaningfulValue(summary.totalOperatingExpenses)");
	});

	it("counts only the recovered portion for partially paid invoices", () => {
		const src = source();

		expect(src).toContain("clampRatio");
		expect(src).toContain("paymentBeforeRange");
		expect(src).toContain("calculateCumulativeRealization");
		expect(src).toContain("calculatePeriodRealization");
		expect(src).toContain("realizedRevenue");
		expect(src).toContain("realizedCogs");
	});

	it("reduces revenue, units, and COGS for approved sales returns before realization", () => {
		const src = source();

		expect(src).toContain("APPROVED_RETURN_STATUSES");
		expect(src).toContain('"approved"');
		expect(src).toContain('"completed"');
		expect(src).toContain("totalRefund");
		expect(src).toContain("totalCost");
		expect(src).toContain("returnedCartons");
		expect(src).toContain("returnedQuantity");
		expect(src).toContain("Math.max(0, line.amount - totalRefund)");
		expect(src).toContain("Math.max(0, line.cogs - totalCost)");
	});

	it("uses frozen invoice-line COGS and never recalculates from current stock cost", () => {
		const src = source();

		expect(src).toContain("invoiceItems.costOfGoodsSold");
		expect(src).toContain("invoiceItems.costOfGoodsSoldPerUnit");
		expect(src).not.toContain("currentStockCost");
		expect(src).not.toContain("todayCost");
		expect(src).not.toContain("recalculateWac");
	});

	it("prevents payroll / commission / TA-DA double counting", () => {
		const src = source();

		expect(src).toContain(
			"slip.grossSalary - slip.commissionAmount - payrollTada",
		);
		expect(src).toContain("commissionExpense += slip.commissionAmount");
		expect(src).toContain("tadaExpense += payrollTada");
		expect(src).toContain("paidInPayslipId === null");
		expect(src).toContain('reimbursedVia !== "payroll"');
	});

	it("excludes capitalized inventory purchases from net profit but shows them in reconciliation", () => {
		const src = source();

		expect(src).toContain("isCapitalizedInventoryExpense");
		expect(src).toContain('"Supplier Purchase"');
		expect(src).toContain("capitalizedInventoryPurchases");
		expect(src).toContain("Less Inventory Purchase Cash Outflows");
	});

	it("treats failed-batch chemical loss as non-cash operating expense with reconciliation add-back", () => {
		const src = source();
		const expensesSource = readFileSync(
			resolve(
				process.cwd(),
				"src/server-functions/reports/expenses-report-fn.ts",
			),
			"utf8",
		);

		expect(src).toContain("failedProductionChemicalRecoveries");
		expect(src).toContain("failedProductionLosses");
		expect(src).toContain("failedBatchLosses");
		expect(src).toContain("Add Back Non-cash Failed Batch Losses");
		expect(expensesSource).toContain("failedBatchLosses");
		expect(expensesSource).toContain("totalFailedBatchLosses");
	});

	it("keeps opening balances, manual adjustments, and salary advances out of net profit", () => {
		const src = source();

		expect(src).toContain('"Opening Balance"');
		expect(src).toContain('"Manual Adjustment"');
		expect(src).toContain('"Advance Payment"');
		expect(src).toContain("manualAdjustments");
		expect(src).toContain("openingBalances");
		expect(src).toContain("advanceOutflows");
	});

	it("surfaces non-recipe-linked sales as an explicit fallback bucket instead of dropping them", () => {
		const src = source();

		expect(src).toContain('"unmapped"');
		expect(src).toContain('"Unmapped Sales"');
	});

	it("keeps reconciliation internally consistent for negative balance periods", () => {
		const src = source();

		expect(src).toContain("periodNetMovement");
		expect(src).toContain("balanceAsOfEnd");
		expect(src).toContain("bridgeDifference");
		expect(src).toContain("Remaining Timing Difference");
	});

	it("keeps every line traceable to its source invoice for drill-down", () => {
		const src = source();

		expect(src).toContain("realizedLines");
		expect(src).toContain("invoiceId");
		expect(src).toContain("invoiceItemId");
		expect(src).toContain("adjustedLineRevenue");
		expect(src).toContain("adjustedLineCogs");
		expect(src).toContain("paymentToDate");
	});

	it("product and recipe scopes reuse the same realized snapshot and status logic", () => {
		const scoped = readFileSync(SCOPED_CORE, "utf8");

		expect(scoped).toContain("buildSnapshot");
		expect(scoped).toContain("loadContext");
		expect(scoped).toContain("buildScopedStatus");
		expect(scoped).toContain("no_activity");
		expect(scoped).toContain("break_even");
		expect(scoped).toContain("filterLinesByScope");
		expect(scoped).toContain("metricsFromLines");
		expect(scoped).toContain("failedBatchLosses");
		expect(scoped).toContain("netImpact");
	});

	it("includes older invoices when payment recovery or approved return lands in range", () => {
		const src = source();

		expect(src).toContain("paymentWindowRows");
		expect(src).toContain("returnWindowRows");
		expect(src).toContain("inArray(invoices.id, invoiceIds)");
		expect(src).toContain("paymentDate < range.fromDate");
	});

	it("loads TA/DA by payable timing, not only trip date inside report range", () => {
		const src = source();

		expect(src).toContain("payrollTravelLogRows");
		expect(src).toContain("reimbursedTravelLogRows");
		expect(src).toContain("travelLogs.reimbursedAt");
		expect(src).toContain("tripWindowFrom");
	});

	it("reuses shared realized invoice rows for scoped CSV export", () => {
		const exportSrc = readFileSync(
			resolve(PNL_DIR, "export-csv-fn.ts"),
			"utf8",
		);

		expect(exportSrc).toContain("fetchScopedInvoiceRows");
		expect(exportSrc).toContain("realizedRevenue");
		expect(exportSrc).toContain("realizedCogs");
	});
});

describe("aggregateRealizedInvoiceRows", () => {
	function makeLine(
		overrides: Partial<AggregatableRealizedLine> = {},
	): AggregatableRealizedLine {
		return {
			invoiceId: "inv-1",
			invoiceDate: new Date("2026-06-22"),
			slipNumber: "INV-1",
			customerName: "Hikmat",
			invoiceStatus: "paid",
			recipeId: "recipe-1",
			recipeName: "Rs.100 Pack",
			pack: "Rs.100 Pack",
			realizedRevenue: 4050,
			realizedCogs: 4060,
			realizedCartons: 10,
			realizedUnits: 240,
			realizedRatio: 1,
			paymentToDate: 4050,
			adjustedLineRevenue: 4050,
			adjustedLineCogs: 4060,
			...overrides,
		};
	}

	it("collapses duplicate invoice lines for the same recipe and pack into one row", () => {
		const lines = [
			makeLine({ realizedRevenue: 4050, realizedCogs: 4060 }),
			makeLine({ realizedRevenue: 4050, realizedCogs: 4060 }),
		];

		const result = aggregateRealizedInvoiceRows(
			lines,
			new Map([["recipe-1", "100.000 g"]]),
		);

		expect(result).toHaveLength(1);
		expect(result[0].invoiceId).toBe("inv-1");
		expect(result[0].realizedRevenue).toBe(8100);
		expect(result[0].realizedCogs).toBe(8120);
		expect(result[0].realizedUnits).toBe(480);
		expect(result[0].realizedCartons).toBe(20);
		expect(result[0].realizedRatio).toBe(1);
		expect(result[0].variantLabel).toBe("100.000 g");
	});

	it("keeps lines with different packs separate", () => {
		const lines = [
			makeLine({ pack: "Rs.100 Pack" }),
			makeLine({
				pack: "Rs.200 Pack",
				recipeId: "recipe-2",
				recipeName: "Rs.200 Pack",
				realizedRevenue: 2000,
				realizedCogs: 1500,
				realizedUnits: 120,
				realizedCartons: 5,
				adjustedLineRevenue: 2000,
				adjustedLineCogs: 1500,
				paymentToDate: 2000,
			}),
		];

		const result = aggregateRealizedInvoiceRows(
			lines,
			new Map([
				["recipe-1", "100.000 g"],
				["recipe-2", "200.000 g"],
			]),
		);

		expect(result).toHaveLength(2);
		const pack100 = result.find((r) => r.pack === "Rs.100 Pack");
		const pack200 = result.find((r) => r.pack === "Rs.200 Pack");
		expect(pack100?.realizedRevenue).toBe(4050);
		expect(pack200?.realizedRevenue).toBe(2000);
	});

	it("keeps lines from different invoices separate", () => {
		const lines = [
			makeLine({ invoiceId: "inv-1" }),
			makeLine({
				invoiceId: "inv-2",
				slipNumber: "INV-2",
			}),
		];

		const result = aggregateRealizedInvoiceRows(lines, new Map());

		expect(result).toHaveLength(2);
		expect(result.map((r) => r.invoiceId).sort()).toEqual(["inv-1", "inv-2"]);
	});

	it("recalculates realized ratio from aggregated adjusted revenue", () => {
		const lines = [
			makeLine({
				realizedRevenue: 2025,
				realizedCogs: 2030,
				adjustedLineRevenue: 4050,
				adjustedLineCogs: 4060,
				paymentToDate: 4050,
				realizedRatio: 0.5,
			}),
			makeLine({
				realizedRevenue: 2025,
				realizedCogs: 2030,
				adjustedLineRevenue: 4050,
				adjustedLineCogs: 4060,
				paymentToDate: 4050,
				realizedRatio: 0.5,
			}),
		];

		const result = aggregateRealizedInvoiceRows(lines, new Map());

		expect(result).toHaveLength(1);
		expect(result[0].realizedRatio).toBe(0.5);
		expect(result[0].realizedRevenue).toBe(4050);
	});
});
