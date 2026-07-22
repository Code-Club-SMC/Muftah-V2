import { useQuery } from "@tanstack/react-query";
import { getLowStockAlertsFn } from "@/server-functions/inventory/stock/get-low-stocks-alert-fn";

export const useLowStockAlerts = () => {
  return useQuery({
    queryKey: ["low-stock-alerts"],
    queryFn: getLowStockAlertsFn,
    refetchInterval: 60000, // Refetch every minute
  });
};
