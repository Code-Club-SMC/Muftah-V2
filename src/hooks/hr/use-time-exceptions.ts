import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  decideTimeExceptionsFn,
  getTimeExceptionsFn,
} from "@/server-functions/hr/attendance/time-exceptions-fn";
import type { TimeExceptionDecision } from "@/lib/attendance/time-exceptions";

export type TimeExceptionView = "pending" | "decided" | "all";

export const useTimeExceptions = (view: TimeExceptionView, attendanceId?: string) =>
  useQuery({
    queryKey: ["time-exceptions", view, attendanceId ?? null],
    queryFn: () => getTimeExceptionsFn({ data: { view, attendanceId } }),
  });

const DECISION_TOAST: Record<TimeExceptionDecision, string> = {
  approved_official: "Approved as company work",
  approved_excused: "Excused",
  rejected: "Rejected",
  pending: "Moved back to pending",
};

export const useDecideTimeExceptions = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[]; status: TimeExceptionDecision; note?: string }) =>
      decideTimeExceptionsFn({ data }),
    onSuccess: (result, variables) => {
      for (const key of [
        "time-exceptions",
        "pending-approval-counts",
        "attendance",
        "daily-attendance",
        "employee-attendance-log",
        "payroll",
        "payrolls",
        "payroll-dashboard",
        "payslip-preview",
        "employee-payroll-history",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(`${DECISION_TOAST[variables.status]} (${result.updated})`);
    },
    onError: (err) => toast.error(err.message || "Failed to save decision"),
  });
};
