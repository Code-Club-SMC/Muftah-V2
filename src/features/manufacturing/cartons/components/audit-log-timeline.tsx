import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ADJUSTMENT_TYPE_LABELS, type AdjustmentType } from "@/lib/cartons/carton.types";

type AuditLogEntry = {
  id: string;
  type: AdjustmentType;
  packsBefore: number;
  delta: number;
  packsAfter: number;
  reason?: string | null;
  performedBy?: string | null;
  performedAt: string | Date;
  relatedCartonId?: string | null;
};

type Props = {
  entries: AuditLogEntry[];
  loading?: boolean;
  className?: string;
};

const deltaColor = (delta: number) =>
  delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted-foreground";

const typeColor = (type: AdjustmentType) => {
  if (["TOP_UP", "MERGE_IN", "TRANSFER_IN"].includes(type)) return "text-emerald-700 bg-emerald-500/10 border-emerald-500/20";
  if (["REMOVAL", "RETIRE", "MERGE_OUT", "TRANSFER_OUT"].includes(type)) return "text-red-700 bg-red-500/10 border-red-500/20";
  if (type === "MANUAL_OVERRIDE") return "text-amber-700 bg-amber-500/10 border-amber-500/20";
  if (type.startsWith("QC_HOLD")) return "text-orange-700 bg-orange-500/10 border-orange-500/20";
  if (type.startsWith("DISPATCH")) return "text-purple-700 bg-purple-500/10 border-purple-500/20";
  if (type.startsWith("RETURN")) return "text-blue-700 bg-blue-500/10 border-blue-500/20";
  return "text-muted-foreground bg-muted/50 border-border";
};

export function AuditLogTimeline({ entries, loading, className }: Props) {
  if (loading) {
    return (
      <div className={cn("space-y-3 animate-pulse", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/30 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className={cn("flex items-center justify-center h-24 text-sm text-muted-foreground", className)}>
        No adjustment history recorded.
      </div>
    );
  }

  return (
    <ScrollArea className={cn("max-h-[400px]", className)}>
      <div className="space-y-2">
        {entries.map((entry, idx) => (
          <div
            key={entry.id}
            className={cn(
              "relative flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/20",
              idx === 0 && "border-primary/20 bg-primary/[0.02]",
            )}
          >
            <div className="flex flex-col items-center mt-0.5 shrink-0">
              <Badge
                variant="outline"
                className={cn("text-[8px] font-bold uppercase tracking-wider whitespace-nowrap", typeColor(entry.type))}
              >
                {ADJUSTMENT_TYPE_LABELS[entry.type]}
              </Badge>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.packsBefore}
                </span>
                <span className={cn("font-mono font-bold text-sm", deltaColor(entry.delta))}>
                  {entry.delta > 0 ? "+" : ""}{entry.delta}
                </span>
                <span className="text-muted-foreground text-xs">→</span>
                <span className="font-mono font-bold text-sm">{entry.packsAfter}</span>
              </div>
              {entry.reason && (
                <p className="text-xs text-muted-foreground mt-1 truncate">{entry.reason}</p>
              )}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <span>{format(new Date(entry.performedAt), "MMM d, HH:mm")}</span>
                {entry.performedBy && (
                  <>
                    <span>·</span>
                    <span>{entry.performedBy}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}