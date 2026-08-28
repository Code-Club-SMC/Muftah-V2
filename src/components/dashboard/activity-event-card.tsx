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
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── MODULE CONFIG ──────────────────────────────────────────────────────────

type ModuleConfig = {
  label: string;
  icon: LucideIcon;
  color: string;       // Tailwind text color
  bgColor: string;     // Tailwind bg for icon circle
  borderColor: string; // Accent border
  dotColor: string;    // Timeline dot color
};

const MODULE_CONFIG: Record<string, ModuleConfig> = {
  sales: {
    label: "Sales",
    icon: ShoppingCart,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/20",
    borderColor: "border-l-blue-500/40",
    dotColor: "bg-blue-500",
  },
  finance: {
    label: "Finance",
    icon: DollarSign,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    borderColor: "border-l-emerald-500/40",
    dotColor: "bg-emerald-500",
  },
  hr: {
    label: "HR & Payroll",
    icon: Users,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    borderColor: "border-l-amber-500/40",
    dotColor: "bg-amber-500",
  },
  manufacturing: {
    label: "Manufacturing",
    icon: Factory,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10 border-violet-500/20",
    borderColor: "border-l-violet-500/40",
    dotColor: "bg-violet-500",
  },
  inventory: {
    label: "Inventory",
    icon: Package,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10 border-cyan-500/20",
    borderColor: "border-l-cyan-500/40",
    dotColor: "bg-cyan-500",
  },
  suppliers: {
    label: "Suppliers",
    icon: Truck,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/20",
    borderColor: "border-l-orange-500/40",
    dotColor: "bg-orange-500",
  },
  "user-management": {
    label: "User Management",
    icon: UserCog,
    color: "text-rose-400",
    bgColor: "bg-rose-500/10 border-rose-500/20",
    borderColor: "border-l-rose-500/40",
    dotColor: "bg-rose-500",
  },
  auth: {
    label: "Authentication",
    icon: Shield,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10 border-indigo-500/20",
    borderColor: "border-l-indigo-500/40",
    dotColor: "bg-indigo-500",
  },
};

const DEFAULT_MODULE: ModuleConfig = {
  label: "System",
  icon: Shield,
  color: "text-muted-foreground",
  bgColor: "bg-muted/50 border-border",
  borderColor: "border-l-border",
  dotColor: "bg-muted-foreground",
};

const SEVERITY_BADGE: Record<string, { className: string; label: string }> = {
  critical: {
    className: "bg-red-500/10 text-red-400 border-red-500/20",
    label: "Critical",
  },
  warning: {
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    label: "Warning",
  },
  info: {
    className: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    label: "Info",
  },
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
  const severityBadge = SEVERITY_BADGE[event.severity] ?? SEVERITY_BADGE.info;
  const hasMetadata = event.metadata && Object.keys(event.metadata as Record<string, unknown>).length > 0;

  const timeAgo = formatDistanceToNow(new Date(event.timestamp), { addSuffix: true });
  const fullTimestamp = format(new Date(event.timestamp), "PPpp");

  return (
    <div className="relative pl-8 group">
      {/* Timeline connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-8 bottom-0 w-px bg-border/50 group-hover:bg-border transition-colors" />
      )}

      {/* Timeline dot */}
      <div
        className={cn(
          "absolute left-0 top-2 z-10 size-[23px] rounded-full border-2 border-background flex items-center justify-center shadow-sm",
          config.dotColor,
        )}
      >
        <div className="size-2 rounded-full bg-background/80" />
      </div>

      {/* Event card */}
      <div
        className={cn(
          "relative border border-border/60 bg-card/50 rounded-lg p-4 ml-2 mb-3",
          "hover:bg-card/80 hover:border-border transition-all duration-200",
          "border-l-2",
          config.borderColor,
        )}
      >
        {/* Top row: module badge + time */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex items-center justify-center size-7 rounded-md border",
                config.bgColor,
              )}
            >
              <Icon className={cn("size-3.5", config.color)} />
            </div>

            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-bold uppercase tracking-wider rounded-sm px-1.5 py-0 h-5",
                config.bgColor,
                config.color,
              )}
            >
              {config.label}
            </Badge>

            <Badge
              variant="outline"
              className="text-[10px] font-semibold uppercase tracking-wider rounded-sm px-1.5 py-0 h-5 bg-muted/30 text-muted-foreground border-border/50"
            >
              {formatAction(event.action)}
            </Badge>

            {event.severity !== "info" && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider rounded-sm px-1.5 py-0 h-5",
                  severityBadge.className,
                )}
              >
                {severityBadge.label}
              </Badge>
            )}
          </div>

          <span
            className="text-[11px] text-muted-foreground font-mono tabular-nums whitespace-nowrap cursor-default"
            title={fullTimestamp}
          >
            {timeAgo}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-foreground/90 leading-relaxed mb-1.5">
          {event.description}
        </p>

        {/* Bottom row: actor + entity + metadata toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">
              {event.actorName}
            </span>

            {event.entityLabel && (
              <>
                <span className="text-border">•</span>
                <span className="font-mono text-foreground/60">
                  {event.entityLabel}
                </span>
              </>
            )}

            {event.ipAddress && (
              <>
                <span className="text-border">•</span>
                <span className="font-mono opacity-50">{event.ipAddress}</span>
              </>
            )}
          </div>

          {hasMetadata && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Details
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-200",
                  expanded && "rotate-180",
                )}
              />
            </button>
          )}
        </div>

        {/* Expandable metadata */}
        {expanded && hasMetadata && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <pre className="text-[11px] text-muted-foreground font-mono bg-muted/20 rounded-md p-3 overflow-x-auto max-h-48">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export { MODULE_CONFIG };
