import { deletePayrollFn } from "@/server-functions/hr/payroll/payroll-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useDeletePayroll = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePayrollFn,
    onSuccess: () => {
      toast.success("Payroll deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
    },
  });
};
