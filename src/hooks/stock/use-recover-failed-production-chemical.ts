import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recoverFailedProductionChemicalFn } from "@/server-functions/inventory/stock/recover-failed-production-chemical-fn";

export const useRecoverFailedProductionChemical = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: recoverFailedProductionChemicalFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "profit-loss"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "expenses"] });
    },
  });
};
