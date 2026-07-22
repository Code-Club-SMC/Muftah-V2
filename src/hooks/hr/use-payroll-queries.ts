import {
  listPayrollsFn,
  getPayrollByIdFn,
} from "@/server-functions/hr/payroll/payroll-fn";
import { useSuspenseQuery } from "@tanstack/react-query";

export const usePayrolls = (limit: number = 50) => {
  return useSuspenseQuery({
    queryKey: ["payrolls", limit],
    queryFn: () => listPayrollsFn({ data: { limit } }),
  });
};

export const usePayroll = (payrollId: string) => {
  return useSuspenseQuery({
    queryKey: ["payroll", payrollId],
    queryFn: () => getPayrollByIdFn({ data: { payrollId } }),
  });
};
