import { useMutation, useQueryClient } from "@tanstack/react-query";
import { convertOvertimeToCompOffFn } from "@/server-functions/hr/attendance/convert-overtime-fn";
import { toast } from "sonner";

export function useConvertOvertimeToCompOff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { employeeId: string; attendanceIds: string[] }) => {
      return await convertOvertimeToCompOffFn({ data });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["overtime-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["payslip-preview"] });
      queryClient.invalidateQueries({ queryKey: ["employee-payroll-history"] });
      toast.success("Overtime Converted", {
        description: res.message,
      });
    },
    onError: (err: any) => {
      toast.error("Conversion Failed", {
        description: err.message || "Something went wrong",
      });
    },
  });
}
