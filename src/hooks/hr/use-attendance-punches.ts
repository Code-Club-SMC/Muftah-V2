import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addManualPunchFn,
  correctPunchFn,
  deletePunchFn,
  getEmployeePunchesFn,
} from "@/server-functions/hr/attendance/manual-punches-fn";
import { toast } from "sonner";

export const attendancePunchKeys = {
  all: ["attendance-punches"] as const,
  employeeDate: (employeeId: string, date: string) =>
    ["attendance-punches", employeeId, date] as const,
};

export function useEmployeePunches(employeeId: string, date: string) {
  return useQuery({
    queryKey: attendancePunchKeys.employeeDate(employeeId, date),
    queryFn: () => getEmployeePunchesFn({ data: { employeeId, date } }),
    enabled: Boolean(employeeId && date),
    staleTime: 5_000,
  });
}

function useInvalidateAttendancePunches() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: attendancePunchKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] });
  };
}

export function useAddManualPunch() {
  const invalidate = useInvalidateAttendancePunches();

  return useMutation({
    mutationFn: addManualPunchFn,
    onSuccess: () => {
      invalidate();
      toast.success("Punch added");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add punch");
    },
  });
}

export function useDeletePunch() {
  const invalidate = useInvalidateAttendancePunches();

  return useMutation({
    mutationFn: deletePunchFn,
    onSuccess: () => {
      invalidate();
      toast.success("Punch deleted");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete punch");
    },
  });
}

export function useCorrectPunch() {
  const invalidate = useInvalidateAttendancePunches();

  return useMutation({
    mutationFn: correctPunchFn,
    onSuccess: () => {
      invalidate();
      toast.success("Punch corrected");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to correct punch");
    },
  });
}
