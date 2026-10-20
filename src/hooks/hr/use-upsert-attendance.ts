import { useMutation, useQueryClient } from "@tanstack/react-query";
import { upsertAttendanceFn } from "@/server-functions/hr/attendance/upsert-attendance-fn";
import { clearOrderBookerManualOverrideFn } from "@/server-functions/hr/attendance/clear-order-booker-manual-override-fn";
import { toast } from "sonner";

export const useUpsertAttendance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: upsertAttendanceFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] });
      queryClient.invalidateQueries({ queryKey: ["leave-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["overtime-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["payslip-preview"] });
      queryClient.invalidateQueries({ queryKey: ["employee-payroll-history"] });
      toast.success("Attendance record saved successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save attendance record");
    },
  });
};

export const useClearOrderBookerManualOverride = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearOrderBookerManualOverrideFn,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] });
      toast.success(
        result.restoredTripDriven
          ? "Returned to trip-driven attendance"
          : "Manual override cleared",
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to clear manual override");
    },
  });
};
