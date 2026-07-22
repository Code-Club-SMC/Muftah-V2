import { markPayrollAsPaidFn } from "@/server-functions/hr/payroll/payroll-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useMarkPayrollPaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markPayrollAsPaidFn,
    onSuccess: () => {
      toast.success("Payroll marked as paid successfully");
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
};
