import { useMemo } from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Cell,
  LabelList,
} from "recharts";
import {
  BarChart3,
  ArrowDown,
  ArrowUp,
  Info,
  TrendingDown,
  TrendingUp,
  Calendar,
  ChevronDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCompactNumber,
  formatCurrency,
  formatCurrencyFull,
  formatPreviousPeriodLabel,
  getNet,
  toSafeNumber,
} from "@/lib/dashboard-format";
import { format as formatDate, parseISO } from "date-fns";

type ChartDatum = {
  month: string;
  revenue: number;
  expenses: number;
};

export type PreviousPeriodSummary = {
  startStr: string;
  endStr: string;
  totalRevenue: number;
  totalExpenses: number;
  net: number;
};

type RevenueExpenseChartProps = {
  data: ChartDatum[];
  dateRangeLabel?: string;
  previousPeriod?: PreviousPeriodSummary;
  className?: string;
};

// ── Single-period bar comparison data ────────────────────────────
function buildBarData(revenue: number, expenses: number) {
  return [
    { name: "Revenue", value: toSafeNumber(revenue), color: "#10b981" },
    { name: "Expenses", value: toSafeNumber(expenses), color: "#f43f5e" },
  ];
}

// ── Compute percent change vs previous period ─────────────────────
type Delta = {
  /** Percent change vs previous period. `null` means "not applicable". */
  percent: number | null;
  /** Human-readable label like "+12.3%" or "—". */
  label: string;
  /** Direction for icon + color. */
  direction: "up" | "down" | "flat";
};

function computeDelta(current: number, previous: number): Delta {
  if (previous === 0) {
    if (current === 0) {
      return { percent: 0, label: "0%", direction: "flat" };
    }
    return {
      percent: null,
      label: "new",
      direction: current > 0 ? "up" : "down",
    };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) {
    return { percent: 0, label: "0%", direction: "flat" };
  }
  const direction = rounded > 0 ? "up" : "down";
  return {
    percent: rounded,
    label: `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`,
    direction,
  };
}

// ── KPI block subcomponent ───────────────────────────────────────
function KpiBlock({
  label,
  value,
  delta,
  tone,
  showArrow = false,
  invertDelta = false,
  previousPeriodLabel,
  previousPeriodFull,
}: {
  label: string;
  value: string;
  delta: Delta;
  tone: "positive" | "negative" | "neutral";
  showArrow?: boolean;
  /**
   * For "EXPENSES" — an increase is bad, a decrease is good.
   * Flips the icon/color association for the delta.
   */
  invertDelta?: boolean;
  /** Compact label like "1–31 May 2026" for inline display. */
  previousPeriodLabel?: string;
  /** Full date range used in the hover tooltip. */
  previousPeriodFull?: string;
}) {
  const valueColor =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
        ? "text-rose-500"
        : "text-foreground";

  const isUp = delta.direction === "up";
  const isDown = delta.direction === "down";
  const isFlat = delta.direction === "flat";
  // For inverted metrics (expenses), up is bad and down is good.
  const isGood = invertDelta ? isDown : isUp;
  const isBad = invertDelta ? isUp : isDown;
  const deltaColor = isFlat
    ? "text-muted-foreground"
    : isGood
      ? "text-emerald-600"
      : isBad
        ? "text-rose-500"
        : "text-muted-foreground";
  const DeltaIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="flex items-baseline gap-1.5">
        {showArrow && <ArrowDown className="size-4 text-rose-500 shrink-0" />}
        <span className={cn("text-2xl font-bold tabular-nums", valueColor)}>
          {value}
        </span>
        <span className="text-xs font-medium text-muted-foreground">PKR</span>
      </div>
      <div
        className={cn(
          "text-[10px] inline-flex items-center gap-1 font-semibold",
          deltaColor,
        )}
        title={previousPeriodFull}
      >
        <DeltaIcon className="size-3 shrink-0" />
        <span>{delta.label}</span>
        {previousPeriodLabel ? (
          <span className="text-muted-foreground/70 font-normal">
            vs <span className="font-semibold text-foreground/80">{previousPeriodLabel}</span>
          </span>
        ) : (
          <span className="text-muted-foreground/70 font-normal">
            vs previous period
          </span>
        )}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────
function EmptyChartState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 mb-3">
        <BarChart3 className="size-8 text-slate-300" />
      </div>
      <p className="text-sm font-semibold text-foreground">
        No financial activity found
      </p>
      <p className="text-[11px] text-muted-foreground mt-1 max-w-[240px]">
        Try changing the date range or adding invoices/expenses.
      </p>
    </div>
  );
}

// ── Single-period bar comparison ─────────────────────────────────
function SinglePeriodComparisonChart({
  revenue,
  expenses,
  yAxisTicks,
}: {
  revenue: number;
  expenses: number;
  yAxisTicks: number[];
}) {
  const barData = buildBarData(revenue, expenses);
  const maxVal = Math.max(revenue, expenses, 1);

  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={barData}
            margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="40%"
          >
            <YAxis
              type="number"
              domain={[0, maxVal * 1.1]}
              ticks={yAxisTicks}
              tickFormatter={(v) => formatCompactNumber(v)}
              tick={{
                fill: "#94a3b8",
                fontSize: 10,
                fontWeight: 500,
              }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: "#64748b", fontSize: 11, fontWeight: 500 }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              dy={6}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={80}>
              {barData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                formatter={(v) => formatCompactNumber(Number(v))}
                fill="#475569"
                fontSize={11}
                fontWeight={600}
                offset={8}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insight callouts */}
      <div className="w-[180px] shrink-0 flex flex-col gap-2 pt-2">
        {expenses > revenue && (
          <div className="rounded-lg bg-rose-50 border border-rose-100 p-2.5 flex items-start gap-2">
            <div className="p-1 rounded-md bg-rose-100 shrink-0">
              <TrendingDown className="size-3 text-rose-600" />
            </div>
            <p className="text-[10px] leading-snug text-rose-700">
              Expenses exceeded revenue by{" "}
              <span className="font-bold text-rose-600">
                {formatCurrency(expenses - revenue)}
              </span>
            </p>
          </div>
        )}
        {revenue === 0 && expenses > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 flex items-start gap-2">
            <div className="p-1 rounded-md bg-slate-200 shrink-0">
              <Info className="size-3 text-slate-600" />
            </div>
            <p className="text-[10px] leading-snug text-slate-600">
              No revenue recorded for this period.
            </p>
          </div>
        )}
        {revenue > 0 && revenue >= expenses && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5 flex items-start gap-2">
            <div className="p-1 rounded-md bg-emerald-100 shrink-0">
              <ArrowUp className="size-3 text-emerald-600" />
            </div>
            <p className="text-[10px] leading-snug text-emerald-700">
              Revenue exceeded expenses by{" "}
              <span className="font-bold text-emerald-600">
                {formatCurrency(revenue - expenses)}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-period trend chart ─────────────────────────────────────
function MultiPeriodTrendChart({ data }: { data: ChartDatum[] }) {
  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="20%"
          >
            <YAxis
              tickFormatter={(v) => formatCompactNumber(v)}
              tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <XAxis
              dataKey="month"
              tick={{ fill: "#64748b", fontSize: 11, fontWeight: 500 }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              dy={6}
            />
            <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30} />
            <Bar dataKey="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={30} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────
export function RevenueExpenseChart({
  data,
  dateRangeLabel,
  previousPeriod,
  className,
}: RevenueExpenseChartProps) {
  const totals = useMemo(() => {
    if (!data?.length) return { rev: 0, exp: 0 };
    const rev = data.reduce((s, d) => s + toSafeNumber(d.revenue), 0);
    const exp = data.reduce((s, d) => s + toSafeNumber(d.expenses), 0);
    return { rev, exp };
  }, [data]);

  const revenue = totals.rev;
  const expenses = totals.exp;
  const net = getNet(revenue, expenses);
  const hasData = revenue > 0 || expenses > 0;
  const isLoss = net < 0;
  const isSinglePoint = data?.length === 1;

  // Y-axis ticks based on max value
  const yAxisTicks = useMemo(() => {
    const max = Math.max(revenue, expenses);
    if (max === 0) return [0, 5.5, 11.0, 16.5, 22.0];
    return [0, max * 0.25, max * 0.5, max * 0.75, max * 1.1];
  }, [revenue, expenses]);

  // Period-over-period deltas
  const revenueDelta = computeDelta(
    revenue,
    previousPeriod?.totalRevenue ?? 0,
  );
  const expensesDelta = computeDelta(
    expenses,
    previousPeriod?.totalExpenses ?? 0,
  );
  const netDelta = computeDelta(net, previousPeriod?.net ?? 0);

  // Previous period date labels
  const previousPeriodLabel = previousPeriod
    ? formatPreviousPeriodLabel(previousPeriod.startStr, previousPeriod.endStr)
    : undefined;
  const previousPeriodFull = previousPeriod
    ? `${formatDate(parseISO(previousPeriod.startStr), "dd MMM yyyy")} – ${formatDate(parseISO(previousPeriod.endStr), "dd MMM yyyy")}`
    : undefined;

  return (
    <div
      className={cn(
        "border border-slate-200/70 bg-white rounded-2xl overflow-hidden flex flex-col shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-50 border border-violet-100">
            <BarChart3 className="size-4 text-violet-600" />
          </div>
          <h3 className="text-sm font-bold text-foreground">
            Revenue vs Expenses
          </h3>
        </div>
        {dateRangeLabel && (
          <button
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Calendar className="size-3.5 text-slate-400" />
            <span>{dateRangeLabel}</span>
            <ChevronDown className="size-3 text-slate-400" />
          </button>
        )}
      </div>

      <div className="px-6 pb-4 border-b border-slate-100">
        {/* KPI Row */}
        <div className="grid grid-cols-3 gap-0">
          <div className="pr-4">
            <KpiBlock
              label="REVENUE"
              value={formatCompactNumber(revenue)}
              delta={revenueDelta}
              tone={revenue > 0 ? "positive" : "neutral"}
              previousPeriodLabel={previousPeriodLabel}
              previousPeriodFull={previousPeriodFull}
            />
          </div>
          <div className="px-4 border-l border-slate-200/70">
            <KpiBlock
              label="EXPENSES"
              value={formatCompactNumber(expenses)}
              delta={expensesDelta}
              tone={expenses > 0 ? "negative" : "neutral"}
              invertDelta
              previousPeriodLabel={previousPeriodLabel}
              previousPeriodFull={previousPeriodFull}
            />
          </div>
          <div className="pl-4 border-l border-slate-200/70">
            <KpiBlock
              label="NET"
              value={
                net === 0
                  ? "0"
                  : `${net < 0 ? "-" : ""}${formatCompactNumber(Math.abs(net))}`
              }
              delta={netDelta}
              tone={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}
              showArrow={isLoss}
              previousPeriodLabel={previousPeriodLabel}
              previousPeriodFull={previousPeriodFull}
            />
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="px-6 pt-4 pb-2 h-[280px]">
        {!hasData ? (
          <EmptyChartState />
        ) : isSinglePoint ? (
          <SinglePeriodComparisonChart
            revenue={revenue}
            expenses={expenses}
            yAxisTicks={yAxisTicks}
          />
        ) : (
          <MultiPeriodTrendChart data={data} />
        )}
      </div>

      {/* Footer / Legend */}
      <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-medium text-slate-600">
              Revenue
            </span>
            <span className="text-[11px] font-bold text-slate-900 tabular-nums">
              {formatCurrencyFull(revenue)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-rose-500" />
            <span className="text-[11px] font-medium text-slate-600">
              Expenses
            </span>
            <span className="text-[11px] font-bold text-slate-900 tabular-nums">
              {formatCurrencyFull(expenses)}
            </span>
          </div>
        </div>
        {dateRangeLabel && (
          <div className="px-2.5 py-1 rounded-md bg-slate-50 border border-slate-100 text-[10px] font-medium text-slate-500">
            Current period: {dateRangeLabel}
          </div>
        )}
      </div>
    </div>
  );
}
