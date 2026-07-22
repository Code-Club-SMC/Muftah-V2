import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
  blue: {
    border: "border-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
    activeBg: "bg-blue-500/5",
  },
  rose: {
    border: "border-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
    activeBg: "bg-rose-500/5",
  },
  emerald: {
    border: "border-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
    activeBg: "bg-emerald-500/5",
  },
  violet: {
    border: "border-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
    activeBg: "bg-violet-500/5",
  },
  amber: {
    border: "border-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
    activeBg: "bg-amber-500/5",
  },
};

export function SharpKPICard({
  title,
  value,
  subtext,
  icon: Icon,
  theme,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: any;
  theme: KPITheme;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border,
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px",
        }}
      />
      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-[10px] font-bold  text-muted-foreground uppercase">
          {title}
        </p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>
      <div className="relative z-10 space-y-1">
        <h3 className="text-2xl font-black tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <p className="text-[10px] font-bold uppercase  text-muted-foreground/70">
          {subtext}
        </p>
      </div>
    </motion.div>
  );
}

export function SharpInteractiveKPICard({
  title,
  value,
  subtext,
  icon: Icon,
  theme,
  active,
  onClick,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: any;
  theme: KPITheme;
  active: boolean;
  onClick: () => void;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      onClick={onClick}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border rounded-none shadow-none cursor-pointer transition-colors border-t-2",
        active
          ? cn("border-x border-b", styles.border, styles.activeBg)
          : cn("border-border hover:bg-muted/30", styles.border),
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px",
        }}
      />
      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-[10px] font-bold  text-muted-foreground uppercase">
          {title}
        </p>
        <div className="flex items-center gap-2">
          {active && (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] uppercase font-black rounded-none border-border",
                styles.iconText,
              )}
            >
              Active View
            </Badge>
          )}
          <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
            <Icon className={cn("size-4", styles.iconText)} />
          </div>
        </div>
      </div>
      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-black tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <p className="text-[10px] font-bold uppercase  text-muted-foreground/70">
          {subtext}
        </p>
      </div>
    </motion.div>
  );
}
