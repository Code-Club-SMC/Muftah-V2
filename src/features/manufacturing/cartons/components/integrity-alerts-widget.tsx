import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Clock, Eye, Scale, Database, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntegrityAlertStatus } from "@/lib/cartons/carton.types";

type AlertRow = {
  id: string;
  sku: string;
  batchId: string | null;
  cartonSum: number;
  ledgerTotal: number;
  delta: number;
  status: IntegrityAlertStatus;
  detectedAt: string | Date;
  resolution?: string | null;
};

type Props = {
  alerts: AlertRow[];
  onAcknowledge?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
  onViewDetails?: (alertId: string) => void;
  compact?: boolean;
  className?: string;
};

const statusConfig: Record<
  IntegrityAlertStatus,
  { icon: typeof AlertTriangle; label: string; color: string; border: string; bg: string }
> = {
  OPEN: { icon: AlertTriangle, label: "Open Issue", color: "text-red-600", border: "border-red-500/20", bg: "bg-red-500/5" },
  ACKNOWLEDGED: { icon: Clock, label: "Acknowledged", color: "text-amber-600", border: "border-amber-500/20", bg: "bg-amber-500/5" },
  RESOLVED: { icon: CheckCircle, label: "Resolved", color: "text-emerald-600", border: "border-emerald-500/20", bg: "bg-emerald-500/5" },
};

export function IntegrityAlertsWidget({
  alerts,
  onAcknowledge,
  onResolve,
  onViewDetails,
  compact = false,
  className,
}: Props) {
  if (!alerts.length) {
    return (
      <Card className={cn("border-emerald-500/20 bg-emerald-500/5 shadow-none", className)}>
        <CardContent className="flex items-center gap-4 py-6">
          <div className="size-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle className="size-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-emerald-800 font-bold text-lg">System Integrity Validated</h3>
            <p className="text-sm text-emerald-700/80">All physical carton quantities perfectly match the inventory ledger.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const openCount = alerts.filter((a) => a.status === "OPEN").length;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="p-2 bg-red-500/10 rounded-lg">
          <Scale className="size-5 text-red-600" />
        </div>
        <div>
          <h2 className="font-black text-lg text-foreground tracking-tight">Integrity Alerts</h2>
          <p className="text-xs text-muted-foreground">Discrepancies found between physical cartons and system ledger.</p>
        </div>
        {openCount > 0 && (
          <Badge variant="destructive" className="ml-auto font-black px-3 py-1">
            {openCount} ACTION REQUIRED
          </Badge>
        )}
      </div>

      <div className={cn("grid gap-4", compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
        {alerts.map((alert) => {
          const cfg = statusConfig[alert.status];
          const Icon = cfg.icon;
          
          return (
            <Card key={alert.id} className={cn("relative overflow-hidden shadow-none border-l-4", cfg.border, cfg.bg, `border-l-${cfg.color.replace('text-', '')}`)}>
              {/* Subtle background pattern */}
              <div
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                style={{
                  backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
                  backgroundSize: "8px 8px",
                }}
              />

              <CardHeader className="pb-2 pt-4 px-5">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="font-mono text-sm font-bold">{alert.sku}</CardTitle>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mt-1 flex items-center gap-1">
                      <Clock className="size-3" />
                      Detected {format(new Date(alert.detectedAt), "MMM d, yyyy 'at' HH:mm")}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("uppercase text-[10px] font-black border-current", cfg.color)}>
                    <Icon className="size-3 mr-1" />
                    {cfg.label}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="px-5 py-4">
                <div className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-border/50">
                  
                  <div className="flex flex-col items-center gap-1 w-1/3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                      <Box className="size-3" /> Physical
                    </span>
                    <span className="font-mono font-black text-2xl">{alert.cartonSum.toLocaleString()}</span>
                  </div>

                  <div className="flex flex-col items-center gap-0 w-1/3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Delta</span>
                    <span className={cn(
                      "font-mono font-black text-3xl", 
                      alert.delta > 0 ? "text-red-600" : "text-amber-600"
                    )}>
                      {alert.delta > 0 ? "+" : ""}{alert.delta}
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-1 w-1/3">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                      <Database className="size-3" /> Ledger
                    </span>
                    <span className="font-mono font-black text-2xl">{alert.ledgerTotal.toLocaleString()}</span>
                  </div>

                </div>
              </CardContent>

              <CardFooter className="px-5 pb-4 pt-0 justify-end gap-2">
                {alert.status === "OPEN" && onAcknowledge && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 font-bold text-xs"
                    onClick={() => onAcknowledge(alert.id)}
                  >
                    Acknowledge Issue
                  </Button>
                )}
                {alert.status === "ACKNOWLEDGED" && onResolve && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => onResolve(alert.id)}
                  >
                    Mark as Resolved
                  </Button>
                )}
                {onViewDetails && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 font-bold text-xs"
                    onClick={() => onViewDetails(alert.id)}
                  >
                    <Eye className="size-3.5 mr-1" />
                    Details
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}