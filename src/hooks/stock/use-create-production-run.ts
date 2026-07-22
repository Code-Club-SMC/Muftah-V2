import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createProductionRunFn } from "@/server-functions/inventory/production/create-production-run-fn";

export const useCreateProductionRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProductionRunFn,
    onSuccess: (data) => {
      toast.success(`Production run ${data.batchId} created successfully`);
      // Invalidate all related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create production run");
    },
  });
};
