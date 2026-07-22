import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 pb-2 border-b",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wide text-foreground leading-none">
            {title}
          </h3>
          {description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">
              {description}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
