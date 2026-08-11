import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Landmark,
  Percent,
  PieChart,
  Receipt,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { OfflineReportPendingBanner } from "@/components/reports/offline-report-pending-banner";
import { ReportSourceSelect } from "@/components/reports/report-source-select";
import {
  ChartCard,
  CompanyReportPageHeader,
  FinanceReconciliationSection,
  FinanceSnapshotCard,
  MetricCard,
  MetricCardRow,
  OperatingExpensesSection,
  ProductBreakdownTable,
  ProfitabilityRankingCard,
  ProfitStatusHero,
} from "@/components/reports/profit-loss/company-profitability-overview";
import {
  MarginTrendChart,
  PnlTrendChart,
  ProfitabilityChart,
  RevenueCostSnapshotChart,
  TopGrossProfitBar,
} from "@/components/reports/profit-loss/pnl-charts";
import { PnlLoadingSkeleton } from "@/components/reports/profit-loss/pnl-loading-skeleton";
import {
  PnlEmptyState,
  PnlPrintHeader,
  PnlPrintStyles,
} from "@/components/reports/profit-loss/pnl-report-primitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatPKR } from "@/lib/currency-format";
import {
  parseReportSource,
  reportSourceLabel,
  type ReportSource,
} from "@/lib/report-source";
import { getCompanyProfitLossFn } from "@/server-functions/reports/profit-loss/company-pnl-fn";

export { PnlTerminologyDialog } from "@/components/reports/profit-loss/pnl-terminology-dialog";

const today = new Date();
const defaultFrom = format(startOfMonth(today), "yyyy-MM-dd");
const defaultTo = format(endOfMonth(today), "yyyy-MM-dd");

function searchToRange(from: string, to: string): DateRange {
  return {
    from: parseISO(from),
    to: parseISO(to),
  };
}

export const Route = createFileRoute("/_protected/reports/profit-loss/")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: String(search.from ?? defaultFrom),
    to: String(search.to ?? defaultTo),
    source: parseReportSource(search.source),
  }),
  component: CompanyProfitabilityReportPage,
});

function CompanyProfitabilityReportPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    searchToRange(search.from, search.to),
  );

  useEffect(() => {
    setDateRange(searchToRange(search.from, search.to));
  }, [search.from, search.to]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: [
      "reports",
      "profit-loss",
      "company",
      search.from,
      search.to,
      search.source,
    ],
    queryFn: () =>
      getCompanyProfitLossFn({
        data: {
          dateFrom: search.from,
          dateTo: search.to,
          source: search.source,
        },
      }),
  });

  const handleApply = () => {
    const fromDate = dateRange?.from;
    const toDate = dateRange?.to;
    if (!fromDate || !toDate) {
      return;
    }

    startTransition(() => {
      navigate({
        to: "/reports/profit-loss",
        search: {
          from: format(fromDate, "yyyy-MM-dd"),
          to: format(toDate, "yyyy-MM-dd"),
          source: search.source,
        },
      });
    });
  };

  const handleSourceChange = (source: ReportSource) => {
    startTransition(() => {
      navigate({
        to: "/reports/profit-loss",
        search: { from: search.from, to: search.to, source },
      });
    });
  };

  const handlePrint = () => {
    window.print();
  };

  if (isError) {
    return (
      <main data-pnl-report className="space-y-6">
        <PnlPrintStyles />
        <PnlEmptyState
          title="Unable to load Company Profitability"
          description={error instanceof Error ? error.message : "Unknown error"}
        />
      </main>
    );
  }

  return (
    <main data-pnl-report className="space-y-5 pb-8">
      <PnlPrintStyles />

      <div className="space-y-3 print:hidden">
        <OfflineReportPendingBanner />
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Invoice source</span>
          <ReportSourceSelect
            value={search.source}
            onValueChange={handleSourceChange}
          />
        </div>
        {search.source !== "all" ? (
          <Alert>
            <AlertTitle>Direct invoice contribution</AlertTitle>
            <AlertDescription>
              This view includes{" "}
              {reportSourceLabel(search.source).toLowerCase()}. Shared payroll,
              factory expenses, failed-batch losses, and wallet reconciliation
              are excluded because they cannot be honestly assigned to one
              invoice source.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {data ? (
        <PnlPrintHeader
          title="Company Profitability Overview"
          productName="CleanPro Detergent ERP"
          productCode="Company-wide"
          category="Broad business profitability"
          periodLabel={data.reportPeriod.label}
          generatedAt={data.generatedAt}
        />
      ) : null}

      <CompanyReportPageHeader
        breadcrumbs={[
          { label: "Reports", to: "/reports" },
          { label: "Finance & Profitability" },
          { label: "Company Profitability Overview" },
        ]}
        title="Company Profitability Overview"
        subtitle="Track realized company profit using actual sold cost, approved returns, operating expenses, and finance reconciliation that explains wallet movement."
        avatarLabel="Company Profitability"
        metaBadges={[
          {
            icon: <Landmark className="size-3.5" />,
            text: "Scope: Company-wide",
          },
          {
            icon: <FileSpreadsheet className="size-3.5" />,
            text: `Source: ${reportSourceLabel(search.source)}`,
          },
          {
            icon: <Clock className="size-3.5" />,
            text: `Reporting Period: ${data?.reportPeriod.label ?? `${search.from} - ${search.to}`}`,
          },
        ]}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onApply={handleApply}
        isPending={isFetching}
        dateFrom={search.from}
        dateTo={search.to}
        onPrint={handlePrint}
        source={search.source}
      />

      {isLoading && !data ? <PnlLoadingSkeleton /> : null}

      {data ? (
        <CompanyProfitabilityContent
          key={`${search.from}-${search.to}-${search.source}`}
          data={data}
          from={search.from}
          to={search.to}
          source={search.source}
        />
      ) : null}
    </main>
  );
}

interface DeductionBreakdownRow {
  type: string;
  label: string;
  description: string;
  amount: number;
  impact: number;
}

interface CompanyPnlData {
  generatedAt: string;
  comparisonLabel: string;
  reportPeriod: { label: string };
  status: {
    key: "profit" | "loss" | "break_even" | "no_activity";
    label: string;
    description: string;
  };
  summary: {
    totalRevenue: number;
    totalCogs: number;
    grossProfit: number;
    grossMargin: number;
    invoiceExpenses: number;
    payroll: number;
    commissions: number;
    tada: number;
    generalExpenses: number;
    totalOperatingExpenses: number;
    netProfit: number;
    netMargin: number;
    totalCartons: number;
    totalUnits: number;
    invoiceCount: number;
  };
  deltas: {
    revenuePercent: number;
    grossProfitPercent: number;
    grossMarginPoints: number;
    operatingExpensesPercent: number;
    netProfitPercent: number;
    netMarginPoints: number;
  };
  monthlyTrend: Array<{
    monthKey: string;
    monthLabel: string;
    totalRevenue: number;
    totalCogs: number;
    grossProfit: number;
    grossMargin: number;
    netProfit: number;
    netMargin: number;
  }>;
  perProduct: Array<{
    productId: string;
    productName: string;
    productCategory: string | null;
    revenue: number;
    cogs: number;
    profit: number;
    margin: number;
    invoiceCount: number;
    units: number;
  }>;
  perRecipe: Array<{
    recipeId: string;
    recipeName: string;
    productId: string;
    productName: string;
    revenue: number;
    cogs: number;
    profit: number;
    margin: number;
    invoiceCount: number;
    units: number;
  }>;
  deductionBreakdown: DeductionBreakdownRow[];
  reconciliation: {
    currentAccountBalance: number;
    balanceAsOfStart: number;
    balanceAsOfEnd: number;
    periodNetMovement: number;
    salesInflows: number;
    expenseOutflows: number;
    payrollOutflows: number;
    advanceOutflows: number;
    manualAdjustments: number;
    openingBalances: number;
    otherMovements: number;
    bridgeRows: Array<{
      type: string;
      label: string;
      amount: number;
      direction: "positive" | "negative" | "neutral";
      description: string;
    }>;
  };
}

function CompanyProfitabilityContent({
  data,
  from,
  to,
  source,
}: {
  data: CompanyPnlData;
  from: string;
  to: string;
  source: ReportSource;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const totalProducts = data.perProduct.length;

  const topProducts = useMemo(
    () =>
      [...data.perProduct]
        .sort((left, right) => right.profit - left.profit)
        .slice(0, 8)
        .map((product) => ({
          name: product.productName,
          value: product.profit,
        })),
    [data.perProduct],
  );

  const topRecipes = useMemo(
    () =>
      [...data.perRecipe]
        .sort((left, right) => right.profit - left.profit)
        .slice(0, 8)
        .map((recipe) => ({ name: recipe.recipeName, value: recipe.profit })),
    [data.perRecipe],
  );

  const marginTrendData = useMemo(
    () =>
      data.monthlyTrend.map((row) => ({
        ...row,
        grossMarginPercent: row.grossMargin,
        netMarginPercent: row.netMargin,
      })),
    [data.monthlyTrend],
  );

  const profitabilityData = useMemo(
    () =>
      data.monthlyTrend.map((row) => ({
        ...row,
        grossProfit: row.grossProfit,
        netProfit: row.netProfit,
      })),
    [data.monthlyTrend],
  );

  const visibleDeductions = useMemo(
    () => data.deductionBreakdown.filter((row) => row.amount !== 0),
    [data.deductionBreakdown],
  );

  return (
    <>
      <section
        className={
          source === "all" ? "grid gap-4 xl:grid-cols-[5fr,2fr]" : "grid gap-4"
        }
        aria-label="Profit / Loss Status"
      >
        <ProfitStatusHero
          statusKey={data.status.key}
          statusLabel={data.status.label}
          netProfit={data.summary.netProfit}
          description={data.status.description}
          collectedRevenue={data.summary.totalRevenue}
          operatingExpenses={data.summary.totalOperatingExpenses}
          grossProfit={data.summary.grossProfit}
          invoiceCount={data.summary.invoiceCount}
          realizedUnits={data.summary.totalUnits}
        />
        {source === "all" ? (
          <FinanceSnapshotCard
            accountBalanceNow={data.reconciliation.currentAccountBalance}
            balanceAtPeriodEnd={data.reconciliation.balanceAsOfEnd}
            periodWalletMovement={data.reconciliation.periodNetMovement}
          />
        ) : null}
      </section>

      <MetricCardRow>
        <MetricCard
          label="Collected Revenue"
          value={formatPKR(data.summary.totalRevenue, false)}
          delta={data.deltas.revenuePercent}
          deltaLabel={data.comparisonLabel}
          icon={DollarSign}
          accent="blue"
        />
        <MetricCard
          label="Gross Profit"
          value={formatPKR(data.summary.grossProfit, false)}
          delta={data.deltas.grossProfitPercent}
          deltaLabel={data.comparisonLabel}
          icon={TrendingUp}
          accent="emerald"
        />
        <MetricCard
          label="Gross Margin"
          value={`${data.summary.grossMargin.toFixed(2)}%`}
          delta={data.deltas.grossMarginPoints}
          deltaLabel={data.comparisonLabel}
          deltaKind="points"
          icon={Percent}
          accent="violet"
        />
        <MetricCard
          label="Operating Expenses"
          value={formatPKR(data.summary.totalOperatingExpenses, false)}
          delta={data.deltas.operatingExpensesPercent}
          deltaLabel={data.comparisonLabel}
          icon={Receipt}
          accent="orange"
        />
        <MetricCard
          label="Net Profit"
          value={formatPKR(data.summary.netProfit, false)}
          delta={data.deltas.netProfitPercent}
          deltaLabel={data.comparisonLabel}
          icon={data.summary.netProfit < 0 ? TrendingDown : Wallet}
          accent="rose"
        />
        <MetricCard
          label="Net Margin"
          value={`${data.summary.netMargin.toFixed(2)}%`}
          delta={data.deltas.netMarginPoints}
          deltaLabel={data.comparisonLabel}
          deltaKind="points"
          icon={PieChart}
          accent="blue"
        />
      </MetricCardRow>

      <section className="grid gap-4 xl:grid-cols-4">
        <ChartCard number={1} title="Company Trend (Last 6 Months)">
          <PnlTrendChart data={data.monthlyTrend} />
        </ChartCard>

        <ChartCard number={2} title="Revenue vs Cost Snapshot">
          <RevenueCostSnapshotChart
            revenue={data.summary.totalRevenue}
            totalCogs={data.summary.totalCogs}
            grossProfit={data.summary.grossProfit}
            netProfit={data.summary.netProfit}
          />
        </ChartCard>

        <ChartCard number={3} title="Margin Trend">
          <MarginTrendChart data={marginTrendData} />
        </ChartCard>

        <ChartCard number={4} title="Monthly Profitability">
          <ProfitabilityChart data={profitabilityData} />
        </ChartCard>
      </section>

      <section aria-label="Operating Expenses">
        <OperatingExpensesSection
          metrics={[
            {
              label: "Invoice Expenses",
              value: data.summary.invoiceExpenses,
              icon: Users,
              accent: "blue",
            },
            {
              label: "Payroll",
              value: data.summary.payroll,
              icon: Receipt,
              accent: "cyan",
            },
            {
              label: "Commissions",
              value: data.summary.commissions,
              icon: TrendingUp,
              accent: "emerald",
            },
            {
              label: "TA / DA",
              value: data.summary.tada,
              icon: FileSpreadsheet,
              accent: "orange",
            },
            {
              label: "General Expenses",
              value: data.summary.generalExpenses,
              icon: User,
              accent: "violet",
            },
          ]}
          total={data.summary.totalOperatingExpenses}
          hasBreakdown={visibleDeductions.length > 0}
          deductionRows={visibleDeductions}
        />
      </section>

      {source === "all" ? (
        <section aria-label="Finance Reconciliation">
          <FinanceReconciliationSection
            summary={[
              {
                label: "Wallet Movement",
                value: data.reconciliation.periodNetMovement,
                icon: Landmark,
                accent: "blue",
              },
              {
                label: "Sales Inflows",
                value: data.reconciliation.salesInflows,
                icon: ArrowDownLeft,
                accent: "emerald",
              },
              {
                label: "Expense Outflows",
                value: data.reconciliation.expenseOutflows,
                icon: ArrowUpRight,
                accent: "rose",
              },
              {
                label: "Payroll Outflows",
                value: data.reconciliation.payrollOutflows,
                icon: User,
                accent: "violet",
              },
            ]}
            bridgeRows={data.reconciliation.bridgeRows}
          />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <ProfitabilityRankingCard
          title="Top Products by Gross Profit"
          description="Use this as the entry point to the next product-level profitability phase."
          hasData={topProducts.length > 0}
          emptyTitle="No product profitability data"
          emptyDescription="No realized sales were found for the selected reporting period."
        >
          <TopGrossProfitBar
            data={topProducts}
            metricLabel="Gross Profit"
            color="#2563eb"
          />
        </ProfitabilityRankingCard>

        <ProfitabilityRankingCard
          title="Top Recipes by Gross Profit"
          description="Recipe rankings here reflect realized direct gross profit before company-wide operating expenses."
          hasData={topRecipes.length > 0}
          emptyTitle="No recipe profitability data"
          emptyDescription="Recipe rankings will appear once recipe-linked sales exist for the selected period."
        >
          <TopGrossProfitBar
            data={topRecipes}
            metricLabel="Gross Profit"
            color="#2563eb"
          />
        </ProfitabilityRankingCard>
      </section>

      <ProductBreakdownTable
        title="Product Breakdown"
        description="Company-wide realized gross profitability by product. Open a product row to switch into the product P&L flow."
        rows={data.perProduct}
        total={totalProducts}
        from={from}
        to={to}
        page={page}
        pageSize={pageSize}
        source={source}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </>
  );
}
