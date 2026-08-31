import { formatDistanceToNow, format } from "date-fns";
import {
  ShoppingCart,
  DollarSign,
  Users,
  Factory,
  Package,
  Truck,
  UserCog,
  Shield,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// ── MODULE CONFIG ──────────────────────────────────────────────────────────

export type ModuleConfig = {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  badgeClass: string;
  dotColor: string;
};

export const MODULE_CONFIG: Record<string, ModuleConfig> = {
  sales: {
    label: "Sales",
    icon: ShoppingCart,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200/50 dark:border-blue-800/40",
    dotColor: "bg-blue-500",
  },
  finance: {
    label: "Finance",
    icon: DollarSign,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-800/40",
    dotColor: "bg-emerald-500",
  },
  hr: {
    label: "HR & Payroll",
    icon: Users,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/50 dark:border-amber-800/40",
    dotColor: "bg-amber-500",
  },
  manufacturing: {
    label: "Manufacturing",
    icon: Factory,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
    badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200/50 dark:border-purple-800/40",
    dotColor: "bg-purple-500",
  },
  inventory: {
    label: "Inventory",
    icon: Package,
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300",
    badgeClass: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200/50 dark:border-cyan-800/40",
    dotColor: "bg-cyan-500",
  },
  suppliers: {
    label: "Suppliers",
    icon: Truck,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
    badgeClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200/50 dark:border-orange-800/40",
    dotColor: "bg-orange-500",
  },
  "user-management": {
    label: "User Access",
    icon: UserCog,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200/50 dark:border-rose-800/40",
    dotColor: "bg-rose-500",
  },
  auth: {
    label: "Authentication",
    icon: Shield,
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
    badgeClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200/50 dark:border-indigo-800/40",
    dotColor: "bg-indigo-500",
  },
};

export const DEFAULT_MODULE: ModuleConfig = {
  label: "General",
  icon: Shield,
  color: "text-slate-600 dark:text-slate-400",
  bgColor: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200",
  dotColor: "bg-slate-500",
};

export type ActivityEvent = {
  id: string;
  timestamp: Date;
  module: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  actorId: string;
  actorName: string;
  description: string;
  metadata: unknown;
  ipAddress: string | null;
  severity: string;
};

interface ActivityEventCardProps {
  event: ActivityEvent;
  isLast?: boolean;
  onSelect?: (event: ActivityEvent) => void;
}

function getInitials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatActionText(action: string): string {
  switch (action.toLowerCase()) {
    case "created":
      return "created";
    case "updated":
      return "updated";
    case "deleted":
      return "deleted";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "paid":
      return "processed payment for";
    case "login":
      return "signed in to";
    case "logout":
      return "signed out of";
    default:
      return action.replace(/_/g, " ");
  }
}

export function ActivityEventCard({ event, isLast, onSelect }: ActivityEventCardProps) {
  const config = MODULE_CONFIG[event.module] ?? DEFAULT_MODULE;
  const ModuleIcon = config.icon;

  const timeAgo = formatDistanceToNow(new Date(event.timestamp), { addSuffix: true });
  const exactTime = format(new Date(event.timestamp), "h:mm a");
  const fullTimestamp = format(new Date(event.timestamp), "PPpp");

  const isWarning = event.severity === "warning";
  const isCritical = event.severity === "critical";

  return (
    <div className="group relative flex items-start gap-4 pb-6 last:pb-2">
      {/* ── Continuous Timeline Connector Line ──────────────────────── */}
      {!isLast && (
        <div className="absolute left-5 top-11 bottom-0 w-[1.5px] bg-slate-200 dark:bg-slate-800 group-hover:bg-slate-300 dark:group-hover:bg-slate-700 transition-colors" />
      )}

      {/* ── Actor Avatar with Module Badge Indicator ────────────────── */}
      <div className="relative shrink-0 mt-0.5">
        <Avatar className="size-10 rounded-full ring-2 ring-background border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs">
            {getInitials(event.actorName)}
          </AvatarFallback>
        </Avatar>

        {/* Small overlaid department icon */}
        <div
          className={cn(
            "absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full ring-2 ring-background shadow-xs",
            config.bgColor
          )}
          title={config.label}
        >
          <ModuleIcon className="size-2.5" />
        </div>
      </div>

      {/* ── Event Content Card ──────────────────────────────────────── */}
      <div
        onClick={() => onSelect?.(event)}
        className={cn(
          "flex-1 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-card/90 p-4 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all cursor-pointer",
          isCritical && "border-rose-200 bg-rose-50/20 dark:border-rose-900/40 dark:bg-rose-950/10",
          isWarning && "border-amber-200 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10"
        )}
      >
        {/* Top Header: Actor, Action, Entity, Department & Timestamp */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] leading-snug text-slate-800 dark:text-slate-200">
              <span className="font-semibold text-slate-900 dark:text-foreground">
                {event.actorName}
              </span>
              <span className="text-slate-500 dark:text-slate-400 mx-1.5 font-normal">
                {formatActionText(event.action)}
              </span>
              {event.entityLabel ? (
                <span className="font-semibold text-slate-900 dark:text-foreground font-mono">
                  {event.entityLabel}
                </span>
              ) : (
                <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                  {event.entityType.replace(/_/g, " ")}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-xs text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap"
              title={fullTimestamp}
            >
              {timeAgo}
            </span>
            <ChevronRight className="size-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
          </div>
        </div>

        {/* Description / Summary */}
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed font-normal">
          {event.description}
        </p>

        {/* Footer Meta Row */}
        <div className="mt-3 flex items-center justify-between gap-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/60 text-[11px]">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-medium tracking-wide px-2 py-0 h-4.5 rounded-full border",
                config.badgeClass
              )}
            >
              {config.label}
            </Badge>

            {isCritical && (
              <Badge
                variant="outline"
                className="text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800/40 px-2 py-0 h-4.5 rounded-full gap-1"
              >
                <AlertCircle className="size-2.5 text-rose-600" />
                Critical
              </Badge>
            )}

            {isWarning && (
              <Badge
                variant="outline"
                className="text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/40 px-2 py-0 h-4.5 rounded-full gap-1"
              >
                <AlertTriangle className="size-2.5 text-amber-600" />
                Warning
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 text-slate-400 dark:text-slate-500 font-mono text-[11px]">
            {event.ipAddress && <span className="hidden sm:inline">IP: {event.ipAddress}</span>}
            <span>{exactTime}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
