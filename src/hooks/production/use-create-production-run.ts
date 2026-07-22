import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createProductionRunFn } from "@/server-functions/inventory/production/create-production-run-fn";
import { toast } from "sonner";

export const useCreateProductionRun = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProductionRunFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create production run");
    },
  });
};
