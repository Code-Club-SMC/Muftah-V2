import { Badge } from "@/components/ui/badge";
import { toPKTTime } from "@/lib/attendance/time";
import { cn } from "@/lib/utils";

export type PunchTimelineItem = {
  id?: string;
  direction: "in" | "out";
  timestamp: string | Date;
};

function formatPunchTime(timestamp: string | Date) {
  return toPKTTime(timestamp).slice(0, 5);
}

function formatLegacySpan(
  checkIn?: string | null,
  checkOut?: string | null,
): string | null {
  if (!checkIn && !checkOut) return null;
  const start = checkIn ? checkIn.slice(0, 5) : "--:--";
  const end = checkOut ? checkOut.slice(0, 5) : "--:--";
  return `${start} -> ${end}`;
}

export function PunchTimelinePreview({
  punches,
  fallbackCheckIn,
  fallbackCheckOut,
  className,
}: {
  punches: PunchTimelineItem[];
  fallbackCheckIn?: string | null;
  fallbackCheckOut?: string | null;
  className?: string;
}) {
  const legacySpan = formatLegacySpan(fallbackCheckIn, fallbackCheckOut);

  if (punches.length === 0) {
    if (!legacySpan) {
      return <span className="text-muted-foreground/40 text-xs">—</span>;
    }

    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Manual row
        </span>
        <span className="text-xs font-medium text-foreground">{legacySpan}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {punches.length} punch{punches.length === 1 ? "" : "es"}
      </span>
      <div className="flex flex-wrap gap-1">
        {punches.map((punch, index) => (
          <Badge
            key={punch.id ?? `${punch.direction}-${String(punch.timestamp)}-${index}`}
            variant="outline"
            className={cn(
              "rounded-full px-2 py-0 text-[10px] font-semibold uppercase tracking-wide",
              punch.direction === "in"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-400"
                : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-400",
            )}
          >
            {punch.direction} {formatPunchTime(punch.timestamp)}
          </Badge>
        ))}
      </div>
    </div>
  );
}
