import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/create-packaging-allocation-fn";
import { startPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/start-packaging-allocation-fn";
import { logPackagingProgressFn } from "@/server-functions/manufacturing/packaging/log-packaging-progress-fn";
import { completePackagingAllocationFn } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-fn";
import { cancelPackagingAllocationFn } from "@/server-functions/manufacturing/packaging/cancel-packaging-allocation-fn";

export const useCreatePackagingAllocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPackagingAllocationFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Packing job created successfully");
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-allocations"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create packing job");
    },
  });
};

export const useStartPackagingAllocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startPackagingAllocationFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Packing job started");
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-allocations"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start packing job");
    },
  });
};

export const useLogPackagingProgress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logPackagingProgressFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Packaging progress logged successfully");
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-allocations"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to log packaging progress");
    },
  });
};

export const useCompletePackagingAllocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completePackagingAllocationFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Packing job completed successfully");
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-allocations"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to complete packing job");
    },
  });
};

export const useCancelPackagingAllocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelPackagingAllocationFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Packing job cancelled");
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-allocations"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to cancel packing job");
    },
  });
};
