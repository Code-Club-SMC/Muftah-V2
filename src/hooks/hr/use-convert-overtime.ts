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
      queryClient.invalidateQueries({ queryKey: ["hr", "overtime-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "attendance-log"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "employees"] });
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
