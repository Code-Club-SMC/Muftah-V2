import { AlertTriangle } from "lucide-react";
import { useLowStockAlerts } from "@/hooks/stock/use-low-stock-alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export const LowStockAlerts = () => {
  const { data: alerts, isLoading } = useLowStockAlerts();

  if (isLoading || !alerts || alerts.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <AlertTriangle className="size-4 mr-2 text-orange-500" />
          {alerts.length} Low Stock Alert{alerts.length !== 1 ? "s" : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Low Stock Alerts</h4>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="p-2 border rounded text-sm space-y-1"
              >
                <div className="font-medium">
                  {alert.materialName}{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    ({alert.warehouseName})
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Current: {parseFloat(alert.currentStock).toFixed(2)}{" "}
                  {alert.unit} | Min: {parseFloat(alert.minLevel!).toFixed(2)}{" "}
                  {alert.unit}
                </div>
                <Badge variant="destructive" className="text-xs">
                  Reorder Needed
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
