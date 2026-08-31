import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "date-fns";
import {
  Calendar,
  Layers,
  AlertTriangle,
  AlertOctagon,
  Info,
  ShieldCheck,
} from "lucide-react";
import { MODULE_CONFIG, type ActivityEvent } from "./activity-event-card";

interface ActivityDetailSheetProps {
  event: ActivityEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getInitials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function ActivityDetailSheet({
  event,
  open,
  onOpenChange,
}: ActivityDetailSheetProps) {
  if (!event) return null;

  const config = MODULE_CONFIG[event.module] ?? {
    label: event.module,
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };

  const formattedDate = format(
    new Date(event.timestamp),
    "EEEE, MMMM d, yyyy 'at' h:mm:ss a"
  );

  const metadataObj =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : null;

  const hasMetadataEntries = metadataObj && Object.keys(metadataObj).length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col gap-0 border-l border-border bg-background shadow-2xl">
        {/* ── Top Header Banner ─────────────────────────────────────── */}
        <div className="p-6 border-b border-border bg-muted/30 relative">
          <div className="flex items-center gap-2 mb-3">
            <Badge
              variant="outline"
              className={`text-[11px] font-semibold tracking-wide px-2.5 py-0.5 rounded-full border-0 ${config.bgColor}`}
            >
              {config.label}
            </Badge>

            {event.severity === "critical" ? (
              <Badge
                variant="outline"
                className="text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800/40 gap-1 px-2.5 py-0.5 rounded-full"
              >
                <AlertOctagon className="size-3 text-rose-600" />
                Critical Action
              </Badge>
            ) : event.severity === "warning" ? (
              <Badge
                variant="outline"
                className="text-[11px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/40 gap-1 px-2.5 py-0.5 rounded-full"
              >
                <AlertTriangle className="size-3 text-amber-600" />
                Warning
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700 gap-1 px-2.5 py-0.5 rounded-full"
              >
                <Info className="size-3 text-slate-500" />
                Standard Event
              </Badge>
            )}
          </div>

          <SheetTitle className="text-base font-semibold text-foreground leading-snug">
            {event.description}
          </SheetTitle>
        </div>

        {/* ── Sheet Body Details ────────────────────────────────────── */}
        <div className="p-6 space-y-6 flex-1">
          {/* Operator Section */}
          <div className="space-y-2.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Executed By
            </h4>
            <div className="flex items-center gap-3.5 p-3.5 rounded-xl border border-border bg-card/60 shadow-xs">
              <Avatar className="size-10 rounded-full ring-2 ring-primary/10 border border-border">
                <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                  {getInitials(event.actorName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {event.actorName}
                </p>
              </div>
            </div>
          </div>

        {/* Event Context Grid */}
        <div className="space-y-2.5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Event Context
          </h4>
          <div className="grid grid-cols-1 gap-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-border bg-card/40 text-xs gap-2">
              <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                <Calendar className="size-3.5 text-slate-400" />
                <span>Timestamp</span>
              </div>
              <span className="font-medium text-foreground sm:text-right text-left break-words">
                {formattedDate}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-border bg-card/40 text-xs gap-2">
              <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                <Layers className="size-3.5 text-slate-400" />
                <span>Target Entity</span>
              </div>
              <div className="flex items-center gap-1.5 sm:justify-end flex-wrap">
                <span className="capitalize text-muted-foreground">{event.entityType.replace(/_/g, " ")}:</span>
                <span className="font-semibold text-foreground">{event.entityLabel || event.entityId || "—"}</span>
              </div>
            </div>
          </div>
        </div>

          {/* Recorded Attributes (Human-Readable Key-Value Grid) */}
          {hasMetadataEntries && (
            <div className="space-y-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Recorded Changes & Attributes
              </h4>
              <div className="rounded-xl border border-border bg-card/60 divide-y divide-border overflow-hidden shadow-xs">
                {Object.entries(metadataObj!).map(([key, val]) => (
                  <div key={key} className="flex items-start justify-between p-3 text-xs gap-4">
                    <span className="font-medium text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
                    </span>
                    <span className="font-semibold text-foreground text-right break-all">
                      {typeof val === "object" ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security & Audit Footer */}
          <div className="pt-2">
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs">
              <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
              <span>Immutable audit record registered to system ledger.</span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
