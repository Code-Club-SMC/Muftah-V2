import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

type Props = {
  currentLevel: number;
  labels: Record<number, string> | undefined;
  onLevelClick?: (level: number) => void;
  editable?: boolean;
};

const LEVEL_KEYS = ["0", "1", "2", "3"] as const;

const levelStyles: Record<number, { bar: string; dot: string; text: string }> = {
  0: {
    bar: "bg-slate-200 dark:bg-slate-700",
    dot: "bg-slate-400 dark:bg-slate-500 text-white",
    text: "text-slate-600 dark:text-slate-400",
  },
  1: {
    bar: "bg-amber-200 dark:bg-amber-700/40",
    dot: "bg-amber-500 text-white",
    text: "text-amber-700 dark:text-amber-400",
  },
  2: {
    bar: "bg-orange-200 dark:bg-orange-700/40",
    dot: "bg-orange-500 text-white",
    text: "text-orange-700 dark:text-orange-400",
  },
  3: {
    bar: "bg-red-200 dark:bg-red-700/40",
    dot: "bg-red-500 text-white",
    text: "text-red-700 dark:text-red-400",
  },
};

export function EscalationLadder({
  currentLevel,
  labels,
  onLevelClick,
  editable = false,
}: Props) {
  return (
    <div className="relative flex items-start justify-between w-full px-1">
      {LEVEL_KEYS.map((key, idx) => {
        const level = Number(key);
        const isCompleted = level < currentLevel;
        const isCurrent = level === currentLevel;
        const isPending = level > currentLevel;
        const style = levelStyles[level] ?? levelStyles[0];
            const label = labels?.[level] ?? `Level ${level}`;

        return (
          <div
            key={key}
            className="flex-1 flex flex-col items-center relative min-w-0"
          >
            {/* Connector line — not on first */}
            {idx > 0 && (
              <div
                className={cn(
                  "absolute top-4 -left-1/2 w-full h-0.5 -translate-y-1/2",
                  isCompleted || isCurrent
                    ? "bg-primary"
                    : style.bar,
                )}
              />
            )}

            <button
              type="button"
              disabled={!editable || !onLevelClick}
              onClick={() => onLevelClick?.(level)}
              className={cn(
                "relative z-10 flex items-center justify-center size-8 rounded-full border-2 transition-all",
                isCurrent
                  ? `${style.dot} ring-4 ring-primary/20 border-primary scale-110`
                  : isCompleted
                    ? "bg-primary text-primary-foreground border-primary"
                    : `${style.dot} border-transparent opacity-60`,
                editable &&
                  onLevelClick &&
                  "hover:scale-110 cursor-pointer",
                !editable && "cursor-default",
              )}
            >
              {isCompleted ? (
                <Check className="size-4" strokeWidth={3} />
              ) : (
                <span className="text-xs font-bold">L{level}</span>
              )}
            </button>

            <div className="mt-2 text-center w-full px-0.5 min-w-0">
              <p
                className={cn(
                  "text-[10px] font-bold leading-tight",
                  isCurrent
                    ? "text-foreground"
                    : isPending
                      ? "text-muted-foreground/60"
                      : style.text,
                )}
              >
                {label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
