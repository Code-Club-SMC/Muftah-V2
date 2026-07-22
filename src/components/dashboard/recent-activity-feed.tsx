import { format, parseISO, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  PlayCircle,
  XCircle,
  Calendar,
  ArrowRight,
  Package,
  User as UserIcon,
  Clock,
  TrendingUp,
} from "lucide-react";
import { toSafeNumber } from "@/lib/dashboard-format";

type ActivityItem = {
  id: string;
  batchId: string;
  productName: string;
  recipeName: string;
  cartonsProduced: number;
  containersProduced: number;
  status: string;
  operatorName: string;
  date: string | Date;
  totalProductionCost?: number;
};

const STATUS_CONFIG = {
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-700",
    pillBorder: "border-emerald-200",
  },
  in_progress: {
    label: "In Progress",
    icon: PlayCircle,
    pillBg: "bg-blue-50",
    pillText: "text-blue-700",
    pillBorder: "border-blue-200",
  },
  scheduled: {
    label: "Scheduled",
    icon: Calendar,
    pillBg: "bg-amber-50",
    pillText: "text-amber-700",
    pillBorder: "border-amber-200",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    pillBg: "bg-rose-50",
    pillText: "text-rose-700",
    pillBorder: "border-rose-200",
  },
};

function fmtDate(d: string | Date) {
  const obj = typeof d === "string" ? parseISO(d) : d;
  if (!isValid(obj)) return "—";
  return format(obj, "dd MMM, hh:mm a");
}

function timeAgo(d: string | Date) {
  const obj = typeof d === "string" ? parseISO(d) : d;
  if (!isValid(obj)) return "";
  const now = new Date();
  const diffMs = now.getTime() - obj.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function fmtPKR(v: number) {
  const val = toSafeNumber(v);
  if (val === 0) return "0";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RecentActivityFeed({
  data,
  className,
}: {
  data: ActivityItem[];
  className?: string;
}) {
  const hasData = data && data.length > 0;
  const activeCount = data?.filter((d) => d.status === "in_progress").length ?? 0;
  const completedCount = data?.filter((d) => d.status === "completed").length ?? 0;

  return (
    <div
      className={cn(
        "border border-slate-200/70 bg-white rounded-2xl overflow-hidden flex flex-col shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-50 border border-violet-100">
              <Package className="size-4 text-violet-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                Production Log
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Recent batch activity
              </p>
            </div>
          </div>
          <Link
            to="/manufacturing/productions"
            className="flex items-center gap-1 text-[12px] font-medium text-violet-600 hover:text-violet-700 transition-colors"
          >
            All runs
            <ArrowRight className="size-3" />
          </Link>
        </div>

        {/* Status chips */}
        {hasData && (
          <div className="flex items-center gap-2">
            {completedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-100">
                <CheckCircle2 className="size-3 text-emerald-600" />
                <span className="text-[11px] font-medium text-emerald-700">
                  {completedCount} completed
                </span>
              </div>
            )}
            {activeCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-100">
                <PlayCircle className="size-3 text-blue-600" />
                <span className="text-[11px] font-medium text-blue-700">
                  {activeCount} running
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200">
              <Package className="size-3 text-slate-500" />
              <span className="text-[11px] font-medium text-slate-600">
                {data.length} total
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Feed */}
      <div className="flex-1">
        {!hasData ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 mb-3">
              <Package className="size-8 text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              No production runs yet
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-[240px]">
              Production runs will appear here once manufacturing begins.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.map((item) => {
              const cfg =
                STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] ??
                STATUS_CONFIG.scheduled;
              const StatusIcon = cfg.icon;
              const cost = item.totalProductionCost
                ? fmtPKR(item.totalProductionCost)
                : null;
              const output =
                item.cartonsProduced > 0
                  ? `${item.cartonsProduced.toLocaleString()} cartons`
                  : `${item.containersProduced.toLocaleString()} units`;

              return (
                <div
                  key={item.id}
                  className="px-5 py-4 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Status + Info */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-100 shrink-0">
                        <StatusIcon className="size-3.5 text-emerald-600" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                          {item.recipeName}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {item.productName}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className="text-[10px] font-mono font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            #{item.batchId?.slice(-6).toUpperCase()}
                          </span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <UserIcon className="size-2.5" />
                            {item.operatorName}
                          </span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="size-2.5" />
                            {timeAgo(item.date)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Metrics */}
                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <div
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium",
                          cfg.pillBg,
                          cfg.pillText,
                          cfg.pillBorder,
                        )}
                      >
                        {cfg.label}
                      </div>
                      {item.status === "completed" && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <TrendingUp className="size-3 text-emerald-600" />
                          <span className="text-[12px] font-bold text-foreground tabular-nums">
                            {output}
                          </span>
                        </div>
                      )}
                      {cost && (
                        <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                          PKR {cost}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/70 mt-0.5">
                        {fmtDate(item.date)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {hasData && (
        <div className="px-5 py-3 border-t border-slate-100">
          <Link
            to="/manufacturing/productions"
            className="flex items-center justify-center gap-1.5 text-[12px] font-medium text-violet-600 hover:text-violet-700 transition-colors py-1"
          >
            View all production runs
            <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
