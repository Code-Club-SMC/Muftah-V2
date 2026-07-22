import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  PackageCheck,
  PackageOpen,
  Lock,
  Truck,
  AlertTriangle,
  Archive,
} from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import type { CartonStatus } from "@/lib/cartons/carton.types";

type BatchKpis = {
  totalCartons: number;
  completeCartons: number;
  partialCartons: number;
  sealedCartons: number;
  dispatchedCartons: number;
  onHoldCartons: number;
  retiredCartons: number;
  totalPacks: number;
  totalCapacity: number;
  fillRatePct: number;
};

type Props = {
  kpis: BatchKpis;
  selectedStatus?: CartonStatus | "ALL";
  onSelectStatus?: (status: CartonStatus | "ALL") => void;
  className?: string;
};

type KpiCardData = {
  label: string;
  value: number;
  icon: typeof BarChart3;
  color: string;
  bgColor: string;
};

export function BatchKpiCards({ kpis, selectedStatus, onSelectStatus, className }: Props) {
  const cards: (KpiCardData & { statusId: CartonStatus | "ALL" })[] = [
    {
      label: "Total Cartons",
      value: kpis.totalCartons,
      icon: BarChart3,
      color: "text-primary",
      bgColor: "bg-primary/10",
      statusId: "ALL",
    },
    {
      label: "Partial",
      value: kpis.partialCartons,
      icon: PackageOpen,
      color: "text-amber-600",
      bgColor: "bg-amber-500/10",
      statusId: "PARTIAL",
    },
    {
      label: "Complete",
      value: kpis.completeCartons,
      icon: PackageCheck,
      color: "text-blue-600",
      bgColor: "bg-blue-500/10",
      statusId: "COMPLETE",
    },
    {
      label: "Sealed",
      value: kpis.sealedCartons,
      icon: Lock,
      color: "text-emerald-600",
      bgColor: "bg-emerald-500/10",
      statusId: "SEALED",
    },
    {
      label: "Dispatched",
      value: kpis.dispatchedCartons,
      icon: Truck,
      color: "text-purple-600",
      bgColor: "bg-purple-500/10",
      statusId: "DISPATCHED",
    },
    {
      label: "On Hold",
      value: kpis.onHoldCartons,
      icon: AlertTriangle,
      color: "text-orange-600",
      bgColor: "bg-orange-500/10",
      statusId: "ON_HOLD",
    },
    {
      label: "Retired",
      value: kpis.retiredCartons,
      icon: Archive,
      color: "text-red-600",
      bgColor: "bg-red-500/10",
      statusId: "RETIRED",
    },
  ];

  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4", className)}>
      {cards.map((card) => {
        const Icon = card.icon;
        const active = selectedStatus === card.statusId;
        const borderColor = card.color.replace("text-", "border-");

        return (
          <motion.div
            key={card.label}
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            onClick={() => onSelectStatus?.(card.statusId)}
            className={cn(
              "relative flex flex-col justify-between p-5 bg-card border rounded-none shadow-none transition-colors border-t-2",
              onSelectStatus ? "cursor-pointer" : "",
              active
                ? cn("border-x border-b", borderColor, card.bgColor)
                : cn("border-border hover:bg-muted/30", borderColor),
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
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {card.label}
              </p>
              <div className="flex items-center gap-2">
                {active && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] uppercase font-black rounded-none border-border px-1.5",
                      card.color,
                    )}
                  >
                    Active View
                  </Badge>
                )}
                <div className={cn("p-1.5 rounded-none", card.bgColor)}>
                  <Icon className={cn("size-4", card.color)} />
                </div>
              </div>
            </div>
            
            <div className="relative z-10 space-y-1">
              <h3 className={cn("text-3xl font-bold tracking-tight", active ? card.color : "text-foreground")}>
                {card.value.toLocaleString()}
              </h3>
              <p className="text-xs font-medium text-muted-foreground/70">
                Cartons
              </p>
            </div>
          </motion.div>
        );
      })}

      {/* Fill Rate Card - spans 2 cols */}
      <Card className="col-span-2 relative overflow-hidden border-primary/10 bg-gradient-to-br from-primary/5 via-background to-background">
        <div className="absolute top-0 right-0 p-3 opacity-[0.06]">
          <BarChart3 className="size-24 -mr-8 -mt-8 text-primary" />
        </div>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-black uppercase tracking-wider text-primary flex items-center gap-1.5">
            Fill Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black tabular-nums text-primary">
              {kpis.fillRatePct.toFixed(1)}%
            </p>
            <span className="text-xs text-muted-foreground font-medium">
              {kpis.totalPacks.toLocaleString()} / {kpis.totalCapacity.toLocaleString()} packs
            </span>
          </div>
          <div className="mt-3 h-2 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${Math.min(kpis.fillRatePct, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}