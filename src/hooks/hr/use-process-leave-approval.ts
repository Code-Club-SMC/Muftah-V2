import { useMutation, useQueryClient } from "@tanstack/react-query";
import { processLeaveApprovalFn } from "@/server-functions/hr/attendance/leave-approvals-fn";
import { toast } from "sonner";

export const useProcessLeaveApproval = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: {
            id: string;
            status: "approved" | "rejected" | "pending";
        }) => {
            return await processLeaveApprovalFn({ data });
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["attendance"] });
            queryClient.invalidateQueries({ queryKey: ["leave-approvals"] });
            queryClient.invalidateQueries({ queryKey: ["overtime-approvals"] });
            const status = data.leaveApprovalStatus;
            toast.success(
                `Leave ${status === "approved" ? "approved — no salary deduction" : status === "rejected" ? "rejected — deduction will apply" : "reset to pending"}`
            );
        },
        onError: (err) => {
            toast.error(err.message || "Failed to process leave approval");
        },
    });
};
