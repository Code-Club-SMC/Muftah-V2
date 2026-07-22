import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adjustStockFn } from "@/server-functions/inventory/stock/adjust-stock-fn";

export const useAdjustStock = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: adjustStockFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
      queryClient.invalidateQueries({ queryKey: ["consumption-history"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
    },
  });
};
