import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Target } from "lucide-react";
import {
  formatCompactNumber,
  toSafeNumber,
} from "@/lib/dashboard-format";

const SEGMENTS = [
  { key: "raw", name: "Raw Material", color: "#f59e0b" },
  { key: "finished", name: "Finished Goods", color: "#0ea5e9" },
  { key: "payroll", name: "Payroll", color: "#a78bfa" },
  { key: "opex", name: "Opex", color: "#f43f5e" },
];

type CapitalAllocationChartProps = {
  rawStock?: number;
  finishedStock?: number;
  payroll?: number;
  expenses?: number;
  className?: string;
};

export function CapitalAllocationChart({
  rawStock,
  finishedStock,
  payroll,
  expenses,
  className,
}: CapitalAllocationChartProps) {
  const values = [
    toSafeNumber(rawStock),
    toSafeNumber(finishedStock),
    toSafeNumber(payroll),
    toSafeNumber(expenses),
  ];
  const total = values.reduce((s, v) => s + v, 0);
  const hasData = total > 0;

  const segments = SEGMENTS.map((seg, i) => ({
    ...seg,
    value: values[i],
    pct: total > 0 ? (values[i] / total) * 100 : 0,
  }));

  // For donut chart - only show segments with data
  const chartData = hasData
    ? segments.filter((s) => s.value > 0)
    : segments.map((s) => ({ ...s, value: 25 }));

  return (
    <div
      className={cn(
        "border border-slate-200/70 bg-white rounded-2xl overflow-hidden flex flex-col shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div className="p-2 rounded-lg bg-violet-50 border border-violet-100">
          <Target className="size-4 text-violet-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">Capital Vector</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Asset allocation breakdown
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 flex-1 flex flex-col">
        {/* Donut chart */}
        <div className="relative h-[220px] w-full flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                paddingAngle={hasData ? 3 : 0}
                dataKey="value"
                stroke="none"
                cornerRadius={hasData ? 4 : 0}
                startAngle={90}
                endAngle={-270}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    opacity={hasData ? 1 : 0.2}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Total Assets
            </span>
            <span className="text-3xl font-bold text-foreground tabular-nums mt-1">
              {hasData ? formatCompactNumber(total) : "0"}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
              PKR
            </span>
          </div>
        </div>

        {/* Asset rows */}
        <div className="mt-5 space-y-3">
          {segments.map((seg) => {
            const isActive = seg.value > 0;
            return (
              <div key={seg.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className="size-2 rounded-sm"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span
                      className={cn(
                        "text-[12px] font-medium",
                        isActive ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {seg.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "text-[11px] font-bold tabular-nums",
                        isActive ? "text-foreground" : "text-muted-foreground/40",
                      )}
                    >
                      {seg.pct.toFixed(0)}%
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-medium tabular-nums",
                        isActive ? "text-muted-foreground" : "text-muted-foreground/40",
                      )}
                    >
                      PKR {formatCompactNumber(seg.value)}
                    </span>
                  </div>
                </div>
                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${seg.pct}%`,
                      backgroundColor: seg.color,
                      opacity: isActive ? 1 : 0.3,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
