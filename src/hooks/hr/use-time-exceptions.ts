import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  decideTimeExceptionsFn,
  getTimeExceptionsFn,
  type DecideTimeExceptionsInput,
} from "@/server-functions/hr/attendance/time-exceptions-fn";
import type { TimeExceptionDecision, TimeExceptionView } from "@/lib/attendance/time-exceptions";

export type { TimeExceptionView };
export type TimeExceptionRange = { from?: string; to?: string };

export const useTimeExceptions = (
  view: TimeExceptionView,
  attendanceId?: string,
  range: TimeExceptionRange = {},
) =>
  useQuery({
    queryKey: ["time-exceptions", view, attendanceId ?? null, range.from ?? null, range.to ?? null],
    queryFn: () => getTimeExceptionsFn({ data: { view, attendanceId, ...range } }),
  });

const DECISION_TOAST: Record<TimeExceptionDecision, string> = {
  approved_official: "Approved as company work",
  approved_excused: "Excused",
  rejected: "Rejected",
  pending: "Moved back to pending",
};

// A decision changes the day's pay, so every screen showing attendance or salary refreshes.
const DECISION_QUERY_KEYS = [
  ["time-exceptions"],
  ["pending-approval-counts"],
  ["attendance"],
  ["daily-attendance"],
  ["employee-attendance-log"],
  ["payroll"],
  ["payrolls"],
  ["payroll-dashboard"],
  ["payslip-preview"],
  ["employee-payroll-history"],
];

export const useDecideTimeExceptions = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DecideTimeExceptionsInput) => decideTimeExceptionsFn({ data }),
    onSuccess: (result, variables) => {
      for (const queryKey of DECISION_QUERY_KEYS) queryClient.invalidateQueries({ queryKey });
      toast.success(
        `${DECISION_TOAST[variables.status]}: ${result.updated} item${result.updated !== 1 ? "s" : ""}`,
      );
    },
    onError: (err) => toast.error(err.message || "Failed to save decision"),
  });
};
