import { AlertTriangle } from "lucide-react";
import { useLowStockAlerts } from "@/hooks/stock/use-low-stock-alert";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export const LowStockAlerts = () => {
  const { data: alerts, isLoading, isError, refetch } = useLowStockAlerts();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isError && (
        <Alert variant="destructive" className="w-auto">
          <AlertDescription>
            Unable to check stock
            {alerts?.length ? ". Showing last checked alerts." : "."}
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {isLoading && !alerts && (
        <span role="status" className="text-sm text-muted-foreground">
          Checking stock...
        </span>
      )}
      {!isLoading && !isError && alerts?.length === 0 && (
        <span role="status" className="text-sm text-muted-foreground">
          No stock alerts
        </span>
      )}
      {!!alerts?.length && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <AlertTriangle data-icon="inline-start" />
              {alerts.length} stock alert{alerts.length !== 1 ? "s" : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="flex flex-col gap-2">
              <h4 className="font-semibold text-sm">Stock alerts</h4>
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex flex-col gap-1 rounded border p-2 text-sm"
                  >
                    <p className="font-medium">{alert.materialName}</p>
                    <p className="text-xs text-muted-foreground">
                      {alert.warehouseName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Current:{" "}
                      {Number(alert.currentStock).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 3,
                      })}{" "}
                      {alert.unit} | Minimum:{" "}
                      {Number(alert.minLevel ?? 0).toFixed(2)} {alert.unit}
                    </p>
                    <Badge variant="destructive">
                      {alert.status === "out" ? "Out of stock" : "Low stock"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
