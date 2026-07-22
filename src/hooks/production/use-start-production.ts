import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startProductionFn } from "@/server-functions/inventory/production/start-production-fn";

export const useStartProduction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: startProductionFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operator-production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["production-run"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
    },
  });
};
