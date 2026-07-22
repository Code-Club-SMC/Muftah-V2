import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { overrideBradfordFactorFn } from "@/server-functions/hr/payroll/override-bradford-fn";

export function useOverrideBradford(employeeId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      payslipId: string;
      overrideScore: string | null;
      reason: string;
    }) => {
      return await overrideBradfordFactorFn({ data });
    },
    onSuccess: () => {
      toast.success("Bradford Factor updated. Audit log entry created.");

      // Invalidate with the specific employeeId key so the Suspense query
      // on the history page refetches immediately without a hard refresh.
      // Passing the exact key guarantees TanStack Query marks the correct
      // cached entry as stale and triggers a background refetch.
      if (employeeId) {
        queryClient.invalidateQueries({
          queryKey: ["employee-payroll-history", employeeId],
        });
      } else {
        // Fallback: invalidate all payroll history queries (prefix match)
        queryClient.invalidateQueries({
          queryKey: ["employee-payroll-history"],
        });
      }

      // Also invalidate the payslips cache in case the payslip dialog
      // is open and showing the old Bradford Factor score
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      queryClient.invalidateQueries({ queryKey: ["employee-payslips"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update Bradford Factor");
    },
  });
}