import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveEmployeePayslipFn } from "@/server-functions/hr/payroll/dashboard-fn";
import { toast } from "sonner";

type SavePayslipInput = {
  employeeId: string;
  month: string;
  deductionConfig: {
    manualDeductions: { description: string; amount: number }[];
    deductConveyanceOnLeave: boolean;
  };
  additionalAmounts: {
    bonusAmount: number;
    incentiveAmount: number;
    taxDeduction: number;
    advanceDeduction?: number; // undefined = auto-deduct from DB
    overtimeMultiplier: number;
  };
  arrears?: {
    arrearsAmount: number;
    arrearsFromMonths: string[];
  };
  earlyCutoffDate?: string;
  ignorePastUnmarkedDays?: boolean;
  remarks?: string;
};

export function useSavePayslip(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SavePayslipInput) => saveEmployeePayslipFn({ data }),
    onSuccess: () => {
      toast.success("Draft payslip saved.");
      queryClient.invalidateQueries({ queryKey: ["payrolls"] }); // Updated to match payrolls key
      queryClient.invalidateQueries({ queryKey: ["payroll-dashboard"] });
      onSuccess?.();
    },
    onError: (err) => {
      if (err.message.includes("PAST_UNMARKED_DAYS")) return;
      toast.error("Failed to save draft payslip", { description: err.message });
    },
  });
}
