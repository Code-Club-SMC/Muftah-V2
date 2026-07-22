import { useMutation, useQueryClient } from "@tanstack/react-query";
import { failProductionFn } from "@/server-functions/inventory/production/fail-production-fn";

export const useFailProduction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: failProductionFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operator-production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["production-run"] });
    },
  });
};
