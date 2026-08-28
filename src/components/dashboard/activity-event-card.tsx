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
  ChevronDown,
  Info,
  AlertTriangle,
  AlertOctagon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// ── MODULE CONFIG ──────────────────────────────────────────────────────────

type ModuleConfig = {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
};

const MODULE_CONFIG: Record<string, ModuleConfig> = {
  sales: {
    label: "Sales",
    icon: ShoppingCart,
    color: "text-blue-500 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-500/10",
  },
  finance: {
    label: "Finance",
    icon: DollarSign,
    color: "text-emerald-500 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-500/10",
  },
  hr: {
    label: "HR & Payroll",
    icon: Users,
    color: "text-amber-500 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-500/10",
  },
  manufacturing: {
    label: "Manufacturing",
    icon: Factory,
    color: "text-violet-500 dark:text-violet-400",
    bgColor: "bg-violet-100 dark:bg-violet-500/10",
  },
  inventory: {
    label: "Inventory",
    icon: Package,
    color: "text-cyan-500 dark:text-cyan-400",
    bgColor: "bg-cyan-100 dark:bg-cyan-500/10",
  },
  suppliers: {
    label: "Suppliers",
    icon: Truck,
    color: "text-orange-500 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-500/10",
  },
  "user-management": {
    label: "User Management",
    icon: UserCog,
    color: "text-rose-500 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-500/10",
  },
  auth: {
    label: "Authentication",
    icon: Shield,
    color: "text-indigo-500 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-500/10",
  },
};

const DEFAULT_MODULE: ModuleConfig = {
  label: "System",
  icon: Shield,
  color: "text-muted-foreground",
  bgColor: "bg-muted",
};

// ── ACTION VERB FORMATTING ─────────────────────────────────────────────────

function formatAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ── COMPONENT ──────────────────────────────────────────────────────────────

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
}

export function ActivityEventCard({ event, isLast }: ActivityEventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = MODULE_CONFIG[event.module] ?? DEFAULT_MODULE;
  const Icon = config.icon;
  const hasMetadata = event.metadata && Object.keys(event.metadata as Record<string, unknown>).length > 0;

  const timeAgo = formatDistanceToNow(new Date(event.timestamp), { addSuffix: true });
  const fullTimestamp = format(new Date(event.timestamp), "MMM d, yyyy • h:mm a");

  // Determine severity icon/color
  let SeverityIcon = Info;
  let severityColor = "text-muted-foreground";
  if (event.severity === "warning") {
    SeverityIcon = AlertTriangle;
    severityColor = "text-amber-500 dark:text-amber-400";
  } else if (event.severity === "critical") {
    SeverityIcon = AlertOctagon;
    severityColor = "text-red-500 dark:text-red-400";
  }

  return (
    <div className="group relative flex gap-4 pb-6 last:pb-0">
      {/* Vertical Timeline Line */}
      {!isLast && (
        <div className="absolute left-[19px] top-10 bottom-0 w-px bg-border/40 group-hover:bg-border/60 transition-colors" />
      )}

      {/* Module Icon Avatar */}
      <div className="relative mt-1">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full border border-background shadow-sm ring-1 ring-border/20 z-10 relative bg-background",
          )}
        >
          <div className={cn("flex size-8 items-center justify-center rounded-full", config.bgColor)}>
            <Icon className={cn("size-4", config.color)} />
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex flex-col flex-1 pt-1.5 gap-1 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
          <p className="text-[13px] text-foreground leading-snug">
            <span className="font-semibold">{event.actorName}</span>
            <span className="text-muted-foreground mx-1.5">{formatAction(event.action).toLowerCase()}</span>
            {event.entityLabel ? (
              <span className="font-medium text-foreground/80">{event.entityLabel}</span>
            ) : (
              <span className="font-medium text-foreground/80">{event.entityType.replace(/_/g, " ")}</span>
            )}
            <span className="text-muted-foreground mx-1.5">in</span>
            <span className={cn("font-medium", config.color)}>{config.label}</span>
          </p>

          <span
            className="shrink-0 text-[11px] text-muted-foreground tabular-nums tracking-tight cursor-default whitespace-nowrap"
            title={fullTimestamp}
          >
            {timeAgo}
          </span>
        </div>

        <p className="text-[13px] text-muted-foreground/80 leading-relaxed max-w-3xl mt-0.5">
          {event.description}
        </p>

        {/* Action Bar (Severity, IP, Metadata) */}
        <div className="flex flex-wrap items-center gap-4 mt-2">
          {event.severity !== "info" && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium">
              <SeverityIcon className={cn("size-3.5", severityColor)} />
              <span className={severityColor}>
                {event.severity.charAt(0).toUpperCase() + event.severity.slice(1)}
              </span>
            </div>
          )}

          {event.ipAddress && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-mono">
              <span>{event.ipAddress}</span>
            </div>
          )}

          {hasMetadata && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="group/btn flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>{expanded ? "Hide details" : "View details"}</span>
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-200 group-hover/btn:text-foreground",
                  expanded && "rotate-180"
                )}
              />
            </button>
          )}
        </div>

        {/* Metadata Expandable Area */}
        {expanded && hasMetadata && (
          <div className="mt-3 relative">
            <pre className="text-[11px] text-muted-foreground font-mono bg-muted/30 border border-border/40 rounded-lg p-4 overflow-x-auto max-h-64 shadow-inner">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export { MODULE_CONFIG };
