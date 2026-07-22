import { type CartonStatus, CARTON_STATUS_LABELS } from "@/lib/cartons/carton.types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<
  CartonStatus,
  { variant: "default" | "secondary" | "destructive" | "outline"; className: string }
> = {
  PARTIAL: {
    variant: "secondary",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
  },
  COMPLETE: {
    variant: "secondary",
    className: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400",
  },
  SEALED: {
    variant: "secondary",
    className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400",
  },
  DISPATCHED: {
    variant: "secondary",
    className: "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-400",
  },
  ARCHIVED: {
    variant: "outline",
    className: "bg-muted/50 text-muted-foreground",
  },
  RETIRED: {
    variant: "destructive",
    className: "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400",
  },
  ON_HOLD: {
    variant: "destructive",
    className: "bg-orange-500/10 text-orange-700 border-orange-500/20 dark:text-orange-400",
  },
};

type Props = {
  status: CartonStatus;
  className?: string;
};

export function CartonStatusBadge({ status, className }: Props) {
  const config = statusConfig[status] ?? {
    variant: "outline" as const,
    className: "",
  };

  return (
    <Badge
      variant={config.variant}
      className={cn(
        "px-2.5 py-0.5 font-bold uppercase text-[10px] tracking-wide border",
        config.className,
        className,
      )}
    >
      {CARTON_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}