import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recoverFailedProductionChemicalFn } from "@/server-functions/inventory/stock/recover-failed-production-chemical-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useRecoverFailedProductionChemical = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: recoverFailedProductionChemicalFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "profit-loss"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "expenses"] });
    },
  });
};
