import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  applyCompensatoryCoverFn,
  cancelCompensatoryCashOutFn,
  createCompensatoryCashOutFn,
  listCompensatoryCashOutsFn,
} from "@/server-functions/hr/attendance/compensatory-bank-fn";

const BANK_QUERY_KEYS = [
  ["employee-attendance-log"],
  ["comp-cash-outs"],
  ["daily-attendance"],
  ["employees"],
  ["employee"],
  ["payroll"],
  ["payrolls"],
  ["payroll-dashboard"],
  ["payslip-preview"],
];

function useInvalidateBank() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of BANK_QUERY_KEYS)
      queryClient.invalidateQueries({ queryKey });
  };
}

export const useCompensatoryCashOuts = (employeeId: string) =>
  useQuery({
    queryKey: ["comp-cash-outs", employeeId],
    queryFn: () => listCompensatoryCashOutsFn({ data: { employeeId } }),
  });

export const useApplyCompensatoryCover = () => {
  const invalidate = useInvalidateBank();
  return useMutation({
    mutationFn: (data: { attendanceId: string; hours: number }) =>
      applyCompensatoryCoverFn({ data }),
    onSuccess: (_, { hours }) => {
      invalidate();
      toast.success(
        hours > 0 ? `${hours}h applied from the bank` : "Bank cover removed",
      );
    },
    onError: (err) => toast.error(err.message || "Failed to update bank cover"),
  });
};

export const useCreateCompensatoryCashOut = () => {
  const invalidate = useInvalidateBank();
  return useMutation({
    mutationFn: (data: {
      employeeId: string;
      kind: "cash_out" | "final_settlement";
      hours?: number;
      notes?: string;
    }) => createCompensatoryCashOutFn({ data }),
    onSuccess: (created) => {
      invalidate();
      toast.success(
        `${Number(created.hours)}h will be paid in the next generated payslip`,
      );
    },
    onError: (err) => toast.error(err.message || "Failed to record cash-out"),
  });
};

export const useCancelCompensatoryCashOut = () => {
  const invalidate = useInvalidateBank();
  return useMutation({
    mutationFn: (id: string) => cancelCompensatoryCashOutFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Cash-out cancelled; hours returned to the bank");
    },
    onError: (err) => toast.error(err.message || "Failed to cancel cash-out"),
  });
};
