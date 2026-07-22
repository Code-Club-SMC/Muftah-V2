import {
  createSalaryAdvanceFn,
  approveSalaryAdvanceFn,
  rejectSalaryAdvanceFn,
  updateSalaryAdvanceFn,
} from "@/server-functions/hr/advances/advances-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useCreateSalaryAdvance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSalaryAdvanceFn,
    onSuccess: () => {
      toast.success("Salary advance requested successfully.");
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to create advance"),
  });
};

export const useUpdateSalaryAdvance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSalaryAdvanceFn,
    onSuccess: () => {
      toast.success("Salary advance updated successfully.");
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to update advance"),
  });
};

export const useApproveSalaryAdvance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: approveSalaryAdvanceFn,
    onSuccess: () => {
      toast.success("Salary advance approved and funds disbursed.");
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to approve advance"),
  });
};

export const useRejectSalaryAdvance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: rejectSalaryAdvanceFn,
    onSuccess: () => {
      toast.success("Salary advance rejected.");
      queryClient.invalidateQueries({ queryKey: ["salary-advances"] });
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to reject advance"),
  });
};
