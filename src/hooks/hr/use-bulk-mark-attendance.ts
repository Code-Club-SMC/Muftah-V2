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
