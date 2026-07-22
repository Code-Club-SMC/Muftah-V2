import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  current: number;
  capacity: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeConfig = {
  sm: { bar: "h-1.5", text: "text-[10px]", wrapper: "w-20" },
  md: { bar: "h-2.5", text: "text-xs", wrapper: "w-32" },
  lg: { bar: "h-3.5", text: "text-sm", wrapper: "w-48" },
} as const;

export function PackCountBar({
  current,
  capacity,
  showLabel = true,
  size = "md",
  className,
}: Props) {
  const pct = capacity > 0 ? Math.min((current / capacity) * 100, 100) : 0;
  const cfg = sizeConfig[size];
  const isOverCapacity = current > capacity;
  const isComplete = current === capacity && capacity > 0;
  const isEmpty = current === 0;

  const barColor = isOverCapacity
    ? "bg-red-500"
    : isComplete
      ? "bg-emerald-500"
      : isEmpty
        ? "bg-muted-foreground/20"
        : "bg-amber-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-2", className)}>
          {showLabel && (
            <span className={cn("font-mono font-bold tabular-nums tracking-tight", cfg.text)}>
              {current}<span className="text-muted-foreground">/{capacity}</span>
            </span>
          )}
          <div className={cn("rounded-full overflow-hidden bg-muted/40", cfg.bar, cfg.wrapper)}>
            <div
              className={cn("h-full rounded-full transition-all duration-300", barColor, cfg.bar)}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {current} / {capacity} packs ({pct.toFixed(0)}%)
        {isOverCapacity && " — Over capacity!"}
      </TooltipContent>
    </Tooltip>
  );
}