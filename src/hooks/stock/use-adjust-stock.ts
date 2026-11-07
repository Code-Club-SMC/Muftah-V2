import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adjustStockFn } from "@/server-functions/inventory/stock/adjust-stock-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useAdjustStock = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: adjustStockFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["consumption-history"] });
    },
  });
};
