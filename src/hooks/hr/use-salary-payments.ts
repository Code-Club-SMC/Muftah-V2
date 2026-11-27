import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  changeSalaryAccountFn,
  getSalaryPaymentHistoryFn,
  paySalariesFn,
  recordSalaryRefundFn,
  recoverOverpaidSalaryFn,
  undoSalaryPaymentFn,
} from "@/server-functions/hr/payroll/salary-payments-fn";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

const AFFECTED_KEYS = ["payroll-dashboard", "salary-payments", "wallets", "transactions", "employee-payroll-history"];

function useInvalidateSalaryData() {
  const queryClient = useQueryClient();
  return () => Promise.all(AFFECTED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

export function useCanPaySalaries(): boolean {
  const { data: access } = useViewerAccess();
  const permissions = access?.permissions ?? [];
  return hasPermission(permissions, "hr.manage") && hasPermission(permissions, "finance.manage");
}

export const usePaySalaries = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof paySalariesFn>[0]["data"]) => paySalariesFn({ data }),
    onSuccess: async (result) => {
      toast.success(`${result.paidCount} salar${result.paidCount === 1 ? "y" : "ies"} paid`);
      await invalidate();
    },
    onError: (error: Error) => toast.error("Payment failed", { description: error.message }),
  });
};

export const useChangeSalaryAccount = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof changeSalaryAccountFn>[0]["data"]) => changeSalaryAccountFn({ data }),
    onSuccess: async () => { toast.success("Account changed"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't change the account", { description: error.message }),
  });
};

export const useUndoSalaryPayment = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof undoSalaryPaymentFn>[0]["data"]) => undoSalaryPaymentFn({ data }),
    onSuccess: async () => { toast.success("Payment undone"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't undo the payment", { description: error.message }),
  });
};

export const useRecordSalaryRefund = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof recordSalaryRefundFn>[0]["data"]) => recordSalaryRefundFn({ data }),
    onSuccess: async () => { toast.success("Refund recorded"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't record the refund", { description: error.message }),
  });
};

export const useRecoverOverpaidSalary = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof recoverOverpaidSalaryFn>[0]["data"]) => recoverOverpaidSalaryFn({ data }),
    onSuccess: async () => { toast.success("Will be taken from the next salary"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't set up the recovery", { description: error.message }),
  });
};

export const useSalaryPaymentHistory = (payslipId: string | null | undefined) =>
  useQuery({
    queryKey: ["salary-payments", payslipId],
    queryFn: () => getSalaryPaymentHistoryFn({ data: { payslipId: payslipId! } }),
    enabled: !!payslipId,
  });
