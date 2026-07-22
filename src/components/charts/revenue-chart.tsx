import { useState, useMemo } from "react";
import { formatPKR } from "@/lib/currency-format";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChartDataPoint {
  month: string;
  revenue: number;
  expenses: number;
  payroll: number;
}

interface RevenueExpenseChartProps {
  data: ChartDataPoint[];
}

type TimeRange = "all" | "6m" | "3m";

const ranges: { value: TimeRange; label: string }[] = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "all", label: "All" },
];

// ── Custom Tooltip ──────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const revenue = payload.find((p: any) => p.dataKey === "revenue")?.value ?? 0;
  const expenses =
    payload.find((p: any) => p.dataKey === "expenses")?.value ?? 0;
  const net = revenue - expenses;
  const isProfit = net >= 0;

  return (
    <div className="rounded-xl border border-border bg-popover  p-3 min-w-[172px] text-popover-foreground">
      <p className="text-[10px] font-black uppercase  text-muted-foreground mb-2.5">
        {label}
      </p>

      <div className="space-y-1.5 mb-2.5">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs text-muted-foreground">Revenue</span>
          </div>
          <span className="text-xs font-bold tabular-nums">
            {formatPKR(revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-rose-500 shrink-0" />
            <span className="text-xs text-muted-foreground">Expenses</span>
          </div>
          <span className="text-xs font-bold tabular-nums">
            {formatPKR(expenses)}
          </span>
        </div>
      </div>

      <div className="h-px bg-border mb-2.5" />

      <div className="flex items-center justify-between gap-6">
        <span className="text-xs text-muted-foreground">Net</span>
        <span
          className={cn(
            "text-xs font-black tabular-nums",
            isProfit
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400",
          )}
        >
          {isProfit ? "+" : ""}
          {formatPKR(net)}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export function RevenueExpenseChart({ data }: RevenueExpenseChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  const filteredData = useMemo(() => {
    if (timeRange === "all" || data.length === 0) return data;
    return data.slice(-(timeRange === "6m" ? 6 : 3));
  }, [data, timeRange]);

  const totals = useMemo(() => {
    const rev = filteredData.reduce((s, d) => s + d.revenue, 0);
    const exp = filteredData.reduce((s, d) => s + d.expenses, 0);
    const net = rev - exp;
    const margin = rev > 0 ? ((net / rev) * 100).toFixed(1) : "0.0";
    return { rev, exp, net, margin };
  }, [filteredData]);

  const isProfit = totals.net >= 0;

  return (
    <Card className="col-span-1 lg:col-span-8 border border-border/60 rounded-xl overflow-hidden">
      {/* ── Header ── */}
      <CardHeader className="px-5 py-4 border-b border-border/40 space-y-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Title + summary stats */}
          <div>
            <p className="text-[10px] font-black uppercase  text-muted-foreground mb-0.5">
              Financial Overview
            </p>
            <h3 className="text-base font-black tracking-tight">
              Revenue vs Expenses
            </h3>
          </div>

          {/* Segmented range control */}
          <div className="flex items-center bg-muted rounded-lg p-1 gap-0.5">
            {ranges.map((r) => (
              <button
                key={r.value}
                onClick={() => setTimeRange(r.value)}
                className={cn(
                  "text-[11px] font-black px-3 h-6 rounded-md transition-all duration-150 tracking-wide",
                  timeRange === r.value
                    ? "bg-background text-foreground  ring-1 ring-border/50"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary stat row */}
        <div className="flex items-center gap-4 pt-3 flex-wrap">
          <StatPill
            label="Revenue"
            value={formatPKR(totals.rev)}
            color="emerald"
          />
          <StatPill
            label="Expenses"
            value={formatPKR(totals.exp)}
            color="rose"
          />
          <div className="h-4 w-px bg-border/60 hidden sm:block" />
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-black",
              isProfit
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {isProfit ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            <span>
              {isProfit ? "+" : ""}
              {formatPKR(totals.net)} net · {totals.margin}% margin
            </span>
          </div>
        </div>
      </CardHeader>

      {/* ── Chart ── */}
      <CardContent className="px-2 pt-4 pb-3">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart
            data={filteredData}
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.14} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              vertical={false}
              stroke="hsl(var(--border))"
              strokeOpacity={0.6}
              strokeDasharray="3 3"
            />

            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tick={{
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
                fontWeight: 600,
              }}
            />

            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              width={68}
              tickFormatter={(v) => formatPKR(v)}
              tick={{
                fill: "hsl(var(--muted-foreground))",
                fontSize: 10,
                fontWeight: 500,
              }}
            />

            <Tooltip
              cursor={{
                stroke: "hsl(var(--border))",
                strokeWidth: 1,
                strokeDasharray: "4 4",
              }}
              content={<CustomTooltip />}
            />

            {/* Expenses behind revenue */}
            <Area
              type="monotone"
              dataKey="expenses"
              stroke="#f43f5e"
              strokeWidth={1.5}
              fill="url(#gradExpenses)"
              dot={false}
              activeDot={{ r: 3.5, fill: "#f43f5e", strokeWidth: 0 }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#gradRevenue)"
              dot={false}
              activeDot={{ r: 3.5, fill: "#10b981", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex items-center justify-end gap-4 px-4 pt-1">
          <LegendItem color="bg-emerald-500" label="Revenue" />
          <LegendItem color="bg-rose-500" label="Expenses" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "emerald" | "rose";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "size-2 rounded-full shrink-0",
          color === "emerald" ? "bg-emerald-500" : "bg-rose-500",
        )}
      />
      <span className="text-[10px] text-muted-foreground font-semibold">
        {label}
      </span>
      <span className="text-xs font-black tabular-nums">{value}</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("w-5 h-0.5 rounded-full", color)} />
      <span className="text-[10px] font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
