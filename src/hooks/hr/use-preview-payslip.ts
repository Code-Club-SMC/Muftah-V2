import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { previewEmployeePayslipFn } from "@/server-functions/hr/payroll/dashboard-fn";

interface PreviewPayslipInput {
  employeeId: string;
  month: string;
  manualDeductions: { description: string; amount: number }[];
  additionalAmounts: {
    bonusAmount: number;
    incentiveAmount: number;
    taxDeduction: number;
    advanceDeduction?: number; // undefined = auto-pull approved advances from DB
    overtimeMultiplier: number;
  };
  arrears?: {
    arrearsAmount: number;
    arrearsFromMonths: string[];
  };
  earlyCutoffDate?: string;
}

export function usePreviewPayslip(
  input: PreviewPayslipInput,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "payslip-preview",
      input.employeeId,
      input.month,
      input.manualDeductions,
      input.additionalAmounts,
      input.arrears,
      input.earlyCutoffDate,
    ],
    queryFn: () => previewEmployeePayslipFn({ data: input }),
    enabled: enabled && !!input.employeeId,
    placeholderData: keepPreviousData,
  });
}
