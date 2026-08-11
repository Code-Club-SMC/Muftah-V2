import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Calculator,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileSearch,
  FileText,
  Info as InfoIcon,
  Landmark,
  Loader2,
  type LucideIcon,
  Printer,
  Receipt,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { PnlExportBar } from "@/components/reports/profit-loss/pnl-export-bar";
import type { ReportSource } from "@/lib/report-source";
import { PnlTerminologyDialog } from "@/components/reports/profit-loss/pnl-terminology-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPKR } from "@/lib/currency-format";
import { cn } from "@/lib/utils";

export interface CompanyBreadcrumbItem {
  label: string;
  to?: string;
}

export interface CompanyMetaBadge {
  icon: React.ReactNode;
  text: string;
}

export interface CompanyReportPageHeaderProps {
  breadcrumbs: CompanyBreadcrumbItem[];
  title: string;
  subtitle?: string;
  avatarLabel: string;
  metaBadges: CompanyMetaBadge[];
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onApply: () => void;
  isPending: boolean;
  dateFrom: string;
  dateTo: string;
  onPrint: () => void;
  source: ReportSource;
}

export function CompanyReportPageHeader({
  breadcrumbs,
  title,
  subtitle,
  avatarLabel,
  metaBadges,
  dateRange,
  onDateRangeChange,
  onApply,
  isPending,
  dateFrom,
  dateTo,
  onPrint,
  source,
}: CompanyReportPageHeaderProps) {
  const initials = avatarLabel
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <header className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {breadcrumbs.map((item, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <span
              key={`${item.label}-${index}`}
              className="flex items-center gap-1.5"
            >
              {!isLast && item.to ? (
                <Link
                  to={item.to}
                  className="transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    isLast
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight className="size-3.5 text-muted-foreground/70" />
              ) : null}
            </span>
          );
        })}
      </nav>

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-base font-semibold text-white">
            {initials || "CP"}
          </div>
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
            {metaBadges.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {metaBadges.map((badge, index) => (
                  <span
                    key={`${badge.text}-${index}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-muted-foreground"
                  >
                    <span className="text-muted-foreground/80">
                      {badge.icon}
                    </span>
                    <span className="font-medium text-foreground/90">
                      {badge.text}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 xl:items-end">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
              <DatePickerWithRange
                date={dateRange}
                onDateChange={onDateRangeChange}
                className="w-[230px]"
              />
            </div>
            <Button
              onClick={onApply}
              disabled={!dateRange?.from || isPending}
              className="h-9 min-w-[120px] gap-1.5 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Updating
                </>
              ) : (
                <>
                  <SlidersHorizontal className="size-3.5" />
                  Apply Range
                </>
              )}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PnlExportBar
              dateFrom={dateFrom}
              dateTo={dateTo}
              source={source}
              reportTitle="company-profitability-overview"
            />
            <PnlTerminologyDialog />
            <Button
              variant="outline"
              onClick={onPrint}
              className="h-9 gap-1.5 border-slate-300 bg-white px-3 text-xs hover:bg-slate-50"
            >
              <Printer className="size-3.5" />
              Print
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export type ProfitStatusKey = "profit" | "loss" | "break_even" | "no_activity";

const STATUS_PILL: Record<ProfitStatusKey, { label: string; classes: string }> =
  {
    profit: { label: "PROFIT", classes: "bg-emerald-100 text-emerald-700" },
    loss: { label: "LOSS", classes: "bg-rose-100 text-rose-700" },
    break_even: { label: "BREAK EVEN", classes: "bg-amber-100 text-amber-700" },
    no_activity: {
      label: "NO ACTIVITY",
      classes: "bg-slate-100 text-slate-700",
    },
  };

export interface ProfitStatusHeroProps {
  statusKey: ProfitStatusKey;
  statusLabel: string;
  netProfit: number;
  description: string;
  collectedRevenue: number;
  operatingExpenses: number;
  grossProfit: number;
  invoiceCount: number;
  realizedUnits: number;
}

export function ProfitStatusHero({
  statusKey,
  statusLabel,
  netProfit,
  description,
  collectedRevenue,
  operatingExpenses,
  grossProfit,
  invoiceCount,
  realizedUnits,
}: ProfitStatusHeroProps) {
  const isProfit = netProfit >= 0;
  const pill = STATUS_PILL[statusKey] ?? STATUS_PILL.no_activity;
  const valueColor = isProfit ? "text-emerald-600" : "text-rose-600";

  return (
    <Card className="gap-0 rounded-sm border border-slate-200 bg-white py-0">
      <CardHeader className="space-y-1 px-6 py-4">
        <CardTitle className="text-base font-semibold tracking-tight text-foreground">
          Profit / Loss Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 px-6 py-5">
        <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  pill.classes,
                )}
              >
                {isProfit ? (
                  <TrendingUp className="size-4" />
                ) : (
                  <TrendingDown className="size-4" />
                )}
              </span>
              <span
                className={cn(
                  "inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide",
                  pill.classes,
                )}
              >
                {pill.label || statusLabel}
              </span>
            </div>
            <div
              className={cn(
                "font-mono text-[40px] font-semibold leading-none tracking-tight",
                valueColor,
              )}
            >
              {formatPKR(netProfit, false)}
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="space-y-3">
            <StatusMetricRow
              items={[
                {
                  icon: <DollarSign className="size-3.5" />,
                  label: "Collected Revenue",
                  value: formatPKR(collectedRevenue, false),
                  accent: "blue",
                },
                {
                  icon: <Receipt className="size-3.5" />,
                  label: "Operating Expenses",
                  value: formatPKR(operatingExpenses, false),
                  accent: "orange",
                },
              ]}
            />
            <StatusMetricRow
              items={[
                { label: "Gross Profit", value: formatPKR(grossProfit, false) },
                {
                  label: "Reported Invoices",
                  value: formatNumber(invoiceCount),
                },
                {
                  label: "Realized Units",
                  value: formatNumber(realizedUnits),
                },
              ]}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const ACCENT_BG: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  violet: "bg-violet-50 text-violet-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
  emerald: "bg-emerald-50 text-emerald-600",
  indigo: "bg-indigo-50 text-indigo-600",
  cyan: "bg-cyan-50 text-cyan-600",
};

interface StatusMetricItem {
  icon?: React.ReactNode;
  label: string;
  value: string;
  accent?: keyof typeof ACCENT_BG;
}

function StatusMetricRow({ items }: { items: StatusMetricItem[] }) {
  return (
    <div className="flex divide-x divide-slate-200 overflow-hidden rounded-sm border border-slate-200 bg-white">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-1 items-center gap-2 px-4 py-3.5"
        >
          {item.icon ? (
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                item.accent
                  ? ACCENT_BG[item.accent]
                  : "bg-slate-100 text-slate-600",
              )}
            >
              {item.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
              {item.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface FinanceSnapshotCardProps {
  accountBalanceNow: number;
  balanceAtPeriodEnd: number;
  periodWalletMovement: number;
}

export function FinanceSnapshotCard({
  accountBalanceNow,
  balanceAtPeriodEnd,
  periodWalletMovement,
}: FinanceSnapshotCardProps) {
  const walletPositive = periodWalletMovement >= 0;
  return (
    <Card className="gap-0 rounded-sm border border-slate-200 bg-white py-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-6 py-4">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
          <Landmark className="size-4 text-blue-600" />
          Finance Snapshot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-6 py-5">
        <SnapshotRow
          label="Account Balance Now"
          value={formatPKR(accountBalanceNow, false)}
        />
        <div className="h-px bg-slate-200" />
        <SnapshotRow
          label="Balance at Period End"
          value={formatPKR(balanceAtPeriodEnd, false)}
        />
        <div className="h-px bg-slate-200" />
        <SnapshotRow
          label="Period Wallet Movement"
          value={formatPKR(periodWalletMovement, false)}
          valueClassName={walletPositive ? "text-emerald-600" : "text-rose-600"}
        />
      </CardContent>
    </Card>
  );
}

function SnapshotRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          valueClassName ?? "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export type MetricKind = "currency" | "percent" | "count";

export interface MetricCardProps {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  deltaKind?: "percent" | "points";
  icon: LucideIcon;
  accent: keyof typeof ACCENT_BG;
}

export function MetricCard({
  label,
  value,
  delta,
  deltaLabel,
  deltaKind = "percent",
  icon: Icon,
  accent,
}: MetricCardProps) {
  const isPositive = (delta ?? 0) >= 0;
  const suffix = deltaKind === "points" ? " pp" : "%";
  const formattedDelta =
    delta === undefined || !Number.isFinite(delta)
      ? null
      : `${isPositive ? "↑" : "↓"}${Math.abs(delta).toFixed(2)}${suffix}`;

  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          ACCENT_BG[accent],
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </div>
        {formattedDelta && deltaLabel ? (
          <div
            className={cn(
              "flex items-center gap-1 text-[11px] font-medium",
              isPositive ? "text-emerald-600" : "text-rose-600",
            )}
          >
            <span>{formattedDelta}</span>
            <span className="font-normal text-muted-foreground">
              {deltaLabel}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MetricCardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid divide-y divide-slate-200 overflow-hidden rounded-sm border border-slate-200 bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 md:grid-cols-3 md:divide-x xl:grid-cols-6">
      {children}
    </div>
  );
}

export interface ChartCardProps {
  number?: string | number;
  title: string;
  description?: string;
  info?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function ChartCard({
  number,
  title,
  description,
  info,
  children,
  className,
}: ChartCardProps) {
  return (
    <Card
      className={cn(
        "gap-0 rounded-sm border border-slate-200 bg-white py-0",
        className,
      )}
    >
      <CardHeader className="space-y-1 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-foreground">
            {number !== undefined ? <span>{number}.</span> : null}
            <span>{title}</span>
          </CardTitle>
          {info && description ? (
            <HoverCard openDelay={120}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Section description"
                >
                  <InfoIcon className="size-3.5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                align="end"
                sideOffset={6}
                className="w-72 text-xs leading-relaxed"
              >
                {description}
              </HoverCardContent>
            </HoverCard>
          ) : null}
        </div>
        {description ? (
          <CardDescription className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="px-5 py-4">{children}</CardContent>
    </Card>
  );
}

export interface OperatingExpenseMetric {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: keyof typeof ACCENT_BG;
}

export interface OperatingExpensesSectionProps {
  metrics: OperatingExpenseMetric[];
  total: number;
  hasBreakdown: boolean;
  deductionRows: Array<{
    type: string;
    label: string;
    description: string;
    amount: number;
    impact: number;
  }>;
  number?: string | number;
}

export function OperatingExpensesSection({
  metrics,
  total,
  hasBreakdown,
  deductionRows,
  number,
}: OperatingExpensesSectionProps) {
  return (
    <ChartCard
      number={number}
      title="Operating Expenses"
      description="These operating expenses are included only in the company-wide report. Product and recipe screens stay on direct profitability in Phase 1."
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.label}
                className="flex items-center gap-3 rounded-sm border border-slate-200 bg-white px-4 py-3"
              >
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    ACCENT_BG[metric.accent],
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {metric.label}
                  </div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {formatPKR(metric.value, false)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 rounded-sm border border-slate-200 bg-slate-100 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
            <Calculator className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Total Operating Expenses
            </div>
            <div className="font-mono text-base font-semibold tabular-nums text-foreground">
              {formatPKR(total, false)}
            </div>
          </div>
        </div>

        {!hasBreakdown ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-muted-foreground">
            <FileText className="size-5 text-muted-foreground/70" />
            No operating expenses recorded for this period.
          </div>
        ) : (
          <div className="overflow-hidden rounded-sm border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Expense Type
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Description
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Amount (Rs)
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Impact on Net Profit
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deductionRows.map((row) => (
                  <TableRow key={row.type}>
                    <TableCell className="font-medium text-foreground">
                      {row.label}
                    </TableCell>
                    <TableCell className="max-w-md text-muted-foreground">
                      {row.description}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-foreground">
                      {formatNumber(row.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-rose-600">
                      {formatPKR(row.impact, false)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export interface ReconciliationSummaryCard {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: keyof typeof ACCENT_BG;
}

export interface FinanceReconciliationSectionProps {
  summary: ReconciliationSummaryCard[];
  bridgeRows: Array<{
    type: string;
    label: string;
    amount: number;
    direction: "positive" | "negative" | "neutral";
    description: string;
  }>;
  number?: string | number;
}

export function FinanceReconciliationSection({
  summary,
  bridgeRows,
  number,
}: FinanceReconciliationSectionProps) {
  return (
    <ChartCard
      number={number}
      title="Finance Reconciliation"
      description="This section explains wallet movement separately from operating profit so balance changes remain traceable."
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-sm border border-slate-200 bg-white px-4 py-3"
              >
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    ACCENT_BG[item.accent],
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </div>
                  <div className="font-mono text-base font-semibold tabular-nums text-foreground">
                    {formatPKR(item.value, false)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-sm border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Bridge Item
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Description
                </TableHead>
                <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Amount
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bridgeRows.map((row) => (
                <TableRow key={row.type}>
                  <TableCell className="font-medium text-foreground">
                    {row.label}
                  </TableCell>
                  <TableCell className="max-w-md text-muted-foreground">
                    {row.description}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      row.direction === "negative" && "text-rose-600",
                      row.direction === "positive" && "text-emerald-600",
                      row.direction === "neutral" && "text-muted-foreground",
                    )}
                  >
                    {row.direction === "negative" ? "-" : ""}
                    {formatPKR(row.amount, false)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </ChartCard>
  );
}

export interface ProfitabilityRankingCardProps {
  number?: string | number;
  title: string;
  description?: string;
  hasData: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}

export function ProfitabilityRankingCard({
  number,
  title,
  description,
  hasData,
  emptyTitle,
  emptyDescription,
  children,
}: ProfitabilityRankingCardProps) {
  return (
    <ChartCard number={number} title={title} description={description} info>
      {hasData ? (
        children
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <FileSearch className="size-4" />
          </div>
          <div className="text-sm font-medium text-foreground">
            {emptyTitle}
          </div>
          <div className="max-w-sm text-xs text-muted-foreground">
            {emptyDescription}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface ProductBreakdownRow {
  productId: string;
  productName: string;
  productCategory: string | null;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number;
  invoiceCount: number;
  units: number;
}

export interface ProductBreakdownTableProps {
  number?: string | number;
  title: string;
  description?: string;
  rows: ProductBreakdownRow[];
  total: number;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  source: ReportSource;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function ProductBreakdownTable({
  number,
  title,
  description,
  rows,
  total,
  from,
  to,
  page,
  pageSize,
  source,
  onPageChange,
  onPageSizeChange,
}: ProductBreakdownTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const paginated = rows.slice(start, end);

  return (
    <ChartCard number={number} title={title} description={description}>
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <FileSearch className="size-4" />
          </div>
          <div className="text-sm font-medium text-foreground">
            No product data in this period
          </div>
          <div className="max-w-sm text-xs text-muted-foreground">
            No realized revenue was found for the selected reporting period.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-sm border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Product
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Category
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Revenue
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    COGS
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Gross Profit
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Gross Margin
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Invoices
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Units
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((product) => (
                  <TableRow key={product.productId}>
                    <TableCell className="font-medium text-foreground">
                      {product.productName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.productCategory ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-foreground">
                      {formatPKR(product.revenue, false)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-foreground">
                      {formatPKR(product.cogs, false)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        product.profit < 0
                          ? "text-rose-600"
                          : "text-emerald-600",
                      )}
                    >
                      {formatPKR(product.profit, false)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        product.margin < 0
                          ? "text-rose-600"
                          : "text-emerald-600",
                      )}
                    >
                      {product.margin.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-foreground">
                      {formatNumber(product.invoiceCount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-foreground">
                      {formatNumber(product.units)}
                    </TableCell>
                    <TableCell className="text-right">
                      {product.productId === "unmapped" ? (
                        <span className="text-xs text-muted-foreground">
                          No product mapping
                        </span>
                      ) : (
                        <Link
                          to="/reports/profit-loss/product/$productId"
                          params={{ productId: product.productId }}
                          search={{ from, to, source }}
                          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          Open Product P&amp;L
                          <ArrowRight className="size-3.5" />
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col items-center justify-between gap-3 px-1 pt-1 text-xs text-muted-foreground sm:flex-row">
            <div>
              Showing{" "}
              <span className="font-medium text-foreground">
                {total === 0 ? 0 : start + 1}
              </span>{" "}
              to <span className="font-medium text-foreground">{end}</span> of{" "}
              <span className="font-medium text-foreground">{total}</span>{" "}
              entries
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onPageChange(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-medium text-foreground">
                {safePage}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => onPageSizeChange(Number(value))}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 min-w-[90px] rounded-md border-slate-300 px-2 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

export { ACCENT_BG };
