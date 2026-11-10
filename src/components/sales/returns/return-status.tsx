import { Badge } from "@/components/ui/badge";
import { returnStatusLabel } from "@/lib/sales/returns/return-lifecycle";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  requested: "border-amber-300 text-amber-700 dark:text-amber-400",
  approved: "border-blue-300 text-blue-700 dark:text-blue-400",
  completed: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  rejected: "border-red-300 text-red-700 dark:text-red-400",
  cancelled: "border-muted-foreground/30 text-muted-foreground",
  voided: "border-muted-foreground/30 text-muted-foreground line-through",
};

const BADGE_LABELS: Record<string, string> = {
  approved: "Approved · Awaiting receipt",
};

export function ReturnStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLES[status])}>
      {BADGE_LABELS[status] ?? returnStatusLabel(status)}
    </Badge>
  );
}

const STEPS = ["requested", "approved", "completed"] as const;

function reachedStep(status: string): number {
  if (status === "completed" || status === "voided") return 2;
  if (status === "approved" || status === "cancelled") return 1;
  return 0;
}

/** Requested -> Approved -> Completed, with a stop badge when ended early or voided. */
export function ReturnProgress({ status }: { status: string }) {
  const reached = reachedStep(status);
  const ended = status === "rejected" || status === "cancelled" || status === "voided";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ol aria-label="Return progress" className="flex flex-1 items-center gap-2 text-xs">
        {STEPS.map((step, index) => (
          <li key={step} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                index <= reached ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className={index <= reached ? "font-medium" : "text-muted-foreground"}>
              {returnStatusLabel(step)}
            </span>
            {index < STEPS.length - 1 && (
              <span className={cn("h-px flex-1", index < reached ? "bg-primary" : "bg-border")} />
            )}
          </li>
        ))}
      </ol>
      {ended && <ReturnStatusBadge status={status} />}
    </div>
  );
}
