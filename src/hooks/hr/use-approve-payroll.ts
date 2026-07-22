import { approvePayrollFn } from "@/server-functions/hr/payroll/payroll-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useApprovePayroll = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: approvePayrollFn,
    onSuccess: () => {
      toast.success("Payroll approved successfully");
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
    },
  });
};
