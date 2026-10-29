import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createMixingRunFn } from "@/server-functions/manufacturing/mixing/create-mixing-run-fn";
import { startMixingRunFn } from "@/server-functions/manufacturing/mixing/start-mixing-run-fn";
import { logMixingProgressFn } from "@/server-functions/manufacturing/mixing/log-mixing-progress-fn";
import { completeMixingRunFn } from "@/server-functions/manufacturing/mixing/complete-mixing-run-fn";
import { cancelMixingRunFn } from "@/server-functions/manufacturing/mixing/cancel-mixing-run-fn";
import { failMixingRunFn } from "@/server-functions/manufacturing/mixing/fail-mixing-run-fn";

export const useCreateMixingRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMixingRunFn,
    onSuccess: (result) => {
      if (result.success === false) {
        toast.error(
          "Mixing batch was not created. Transfer the missing chemicals to the selected factory floor.",
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Mixing batch created successfully");
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create mixing batch");
    },
  });
};

export const useStartMixingRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startMixingRunFn,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Mixing batch started successfully");
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", variables.data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", variables.data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["material-lots"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start mixing batch");
    },
  });
};

export const useLogMixingProgress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logMixingProgressFn,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Progress logged successfully");
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", variables.data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", variables.data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to log progress");
    },
  });
};

export const useCompleteMixingRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completeMixingRunFn,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Mixing batch completed successfully");
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", variables.data.mixingRunId],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", variables.data.mixingRunId],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to complete mixing batch");
    },
  });
};

export const useCancelMixingRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelMixingRunFn,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Mixing batch cancelled successfully");
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", variables.data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", variables.data.id],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to cancel mixing batch");
    },
  });
};

export const useFailMixingRun = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: failMixingRunFn,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      toast.success("Mixing batch marked as failed");
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["mixing-run", variables.data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["operator-mixing-run", variables.data.id],
      });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to mark mixing batch as failed");
    },
  });
};
