import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    bulkMarkAttendanceRangeFn,
    previewBulkAttendanceFn,
} from "@/server-functions/hr/attendance/bulk-mark-attendance-range-fn";

type BulkInput = {
    employeeIds: string[];
    startDate: string;
    endDate: string;
    template: {
        status: "present" | "absent" | "leave" | "holiday";
        leaveType?: "sick" | "annual" | "special" | null;
        notes?: string | null;
        entrySource?: "biometric" | "manual" | "qr_terminal";
    };
    conflictStrategy: "skip" | "overwrite";
};

export function useBulkMarkAttendance() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: BulkInput) =>
            bulkMarkAttendanceRangeFn({ data: input }),
        onSuccess: (result) => {
            toast.success(result.message);
            // Invalidate daily attendance and any open log views
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
        },
        onError: (err: any) => {
            toast.error(err.message || "Bulk mark failed");
        },
    });
}

export function useBulkAttendancePreview(
    input: BulkInput | null,
    enabled: boolean,
) {
    return useQuery({
        queryKey: ["bulk-attendance-preview", input],
        queryFn: () => previewBulkAttendanceFn({ data: input! }),
        enabled: enabled && input !== null,
        staleTime: 0,
    });
}
