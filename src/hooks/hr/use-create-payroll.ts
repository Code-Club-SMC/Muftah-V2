import { createPayrollFn } from "@/server-functions/hr/payroll/payroll-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useCreatePayroll = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPayrollFn,
    onSuccess: (data) => {
      toast.success("Payroll Created Successfully", {
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
    },
    onError: (error) => {
      toast.error("Failed to create payroll", {
        description: error.message,
      });
    },
  });
};
