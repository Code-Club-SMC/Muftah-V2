import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatPKR, formatPKRPrecise } from "@/lib/currency-format";

interface CostTrendDataPoint {
  month: string;
  monthLabel: string;
  avgCogsPerUnit: number;
  avgRevenuePerUnit: number;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number;
  units: number;
  avgCostPerUnit: number;
}

interface CostTrendChartProps {
  data: CostTrendDataPoint[];
  recipeName?: string;
}

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

export function CostTrendChart({ data, recipeName }: CostTrendChartProps) {
  const summary = useMemo(() => {
    if (!data.length) return { avgMargin: 0, trend: "flat" as const, latestMargin: 0 };
    const avgMargin = data.reduce((s, d) => s + d.margin, 0) / data.length;
    const latestMargin = data[data.length - 1].margin;
    const firstMargin = data[0].margin;
    const trend = latestMargin > firstMargin + 2 ? "up" : latestMargin < firstMargin - 2 ? "down" : "flat";
    return { avgMargin, trend, latestMargin };
  }, [data]);

  if (!data.length) {
    return (
      <div className="border rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">No cost trend data available for this recipe.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-card print:border-0 print:rounded-none print:bg-transparent">
      {/* Header - screen only */}
      <div className="px-5 pt-4 pb-3 border-b print:hidden">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">
              Cost & Margin Trend
              {recipeName && <span className="text-muted-foreground font-normal ml-1">— {recipeName}</span>}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Monthly WAC, selling price, and margin over the last {data.length} months
            </p>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Avg Margin</p>
              <p className={`text-lg font-black tabular-nums ${summary.avgMargin >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                {summary.avgMargin.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Trend</p>
              <p className={`text-lg font-black flex items-center gap-1 ${
                summary.trend === "up" ? "text-emerald-600" : summary.trend === "down" ? "text-rose-500" : "text-muted-foreground"
              }`}>
                {summary.trend === "up" ? <TrendingUp className="size-4" /> : summary.trend === "down" ? <TrendingDown className="size-4" /> : "—"}
                {summary.trend === "up" ? "Rising" : summary.trend === "down" ? "Falling" : "Stable"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 py-4 min-h-[300px] print:hidden">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeWidth={0.6} opacity={0.4} />
            <XAxis
              dataKey="monthLabel"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
              dy={8}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtK(v)}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
              dx={-4}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
              domain={[-20, 50]}
              dx={4}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1.5, strokeDasharray: "4 3" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload as CostTrendDataPoint;
                if (!d) return null;
                return (
                  <div className="bg-card border border-border/60 rounded-xl shadow-lg p-3 min-w-[200px] text-xs">
                    <p className="font-bold text-foreground mb-2">{label}</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between gap-6">
                        <span className="text-muted-foreground">Revenue/Unit</span>
                        <span className="font-bold text-emerald-600 tabular-nums">{formatPKRPrecise(d.avgRevenuePerUnit)}</span>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-muted-foreground">Cost/Unit (WAC)</span>
                        <span className="font-bold text-rose-500 tabular-nums">{formatPKRPrecise(d.avgCostPerUnit)}</span>
                      </div>
                      <div className="flex justify-between gap-6 pt-1.5 mt-1.5 border-t border-border/40">
                        <span className="text-muted-foreground font-semibold">Margin</span>
                        <span className={`font-black tabular-nums ${d.margin >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                          {d.margin.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-muted-foreground">Total Revenue</span>
                        <span className="font-bold tabular-nums">{formatPKR(d.revenue, false)}</span>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-muted-foreground">Units Sold</span>
                        <span className="font-bold tabular-nums">{d.units.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="line"
              wrapperStyle={{ fontSize: "10px", fontWeight: 600 }}
            />
            <Bar
              yAxisId="left"
              dataKey="revenue"
              fill="hsl(var(--muted-foreground))"
              opacity={0.08}
              radius={[2, 2, 0, 0]}
              name="Revenue"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avgRevenuePerUnit"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="Selling Price/Unit"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avgCostPerUnit"
              stroke="#f43f5e"
              strokeWidth={2}
              dot={false}
              name="WAC/Unit"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="margin"
              stroke="#6366f1"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }}
              name="Margin %"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Print-only summary table */}
      <div className="hidden print:block px-2 pb-2">
        <table className="w-full text-[7pt] border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-1 font-bold">Month</th>
              <th className="text-right py-1 font-bold">Revenue/Unit</th>
              <th className="text-right py-1 font-bold">Cost/Unit</th>
              <th className="text-right py-1 font-bold">Margin</th>
              <th className="text-right py-1 font-bold">Total Revenue</th>
              <th className="text-right py-1 font-bold">Units</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-b border-gray-300">
                <td className="py-0.5">{d.monthLabel}</td>
                <td className="text-right py-0.5 font-mono">{formatPKRPrecise(d.avgRevenuePerUnit)}</td>
                <td className="text-right py-0.5 font-mono">{formatPKRPrecise(d.avgCostPerUnit)}</td>
                <td className={`text-right py-0.5 font-mono font-bold ${d.margin >= 0 ? "" : "underline"}`}>
                  {d.margin.toFixed(1)}%
                </td>
                <td className="text-right py-0.5 font-mono">{formatPKR(d.revenue, false)}</td>
                <td className="text-right py-0.5 font-mono">{d.units.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
