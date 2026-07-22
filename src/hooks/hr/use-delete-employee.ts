import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  deleteEmployeeFn,
  approveEmployeeDeletionFn,
  cancelEmployeeDeletionFn,
} from "@/server-functions/hr/employees/delete-employee-fn";

export const useDeleteEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteEmployeeFn,
    onSuccess: () => {
      toast.success("Employee marked for deletion. Needs admin approval.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-deletion-requests"] });
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to request deletion");
    },
  });
};

export const useApproveEmployeeDeletion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: approveEmployeeDeletionFn,
    onSuccess: () => {
      toast.success("Employee record and all related data permanently removed.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-deletion-requests"] });
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to approve deletion");
    },
  });
};

export const useCancelEmployeeDeletion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelEmployeeDeletionFn,
    onSuccess: () => {
      toast.success("Employee deletion cancelled.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-deletion-requests"] });
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to cancel deletion");
    },
  });
};

