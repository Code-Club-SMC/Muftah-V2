import { useMutation, useQueryClient } from "@tanstack/react-query";
import { processOvertimeFn } from "@/server-functions/hr/attendance/process-overtime-fn";
import { toast } from "sonner";

export const useProcessOvertime = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: { id: string; status: "approved" | "rejected" | "pending" }) => {
            return await processOvertimeFn({ data });
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["attendance"] });
            queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
            queryClient.invalidateQueries({ queryKey: ["pending-approval-counts"] });
            queryClient.invalidateQueries({ queryKey: ["overtime-approvals"] });
            queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] });
            queryClient.invalidateQueries({ queryKey: ["payrolls"] });
            queryClient.invalidateQueries({ queryKey: ["payroll"] });
            queryClient.invalidateQueries({ queryKey: ["payroll-dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["payslip-preview"] });
            queryClient.invalidateQueries({ queryKey: ["employee-payroll-history"] });
            toast.success(
                `Overtime ${data.overtimeStatus === "approved" ? "approved" : data.overtimeStatus === "rejected" ? "rejected" : "reset to pending"}`
            );
        },
        onError: (err) => {
            toast.error(err.message || "Failed to process overtime calculation");
        },
    });
};
