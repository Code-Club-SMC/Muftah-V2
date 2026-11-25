import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    bulkMarkAttendanceRangeFn,
    previewBulkAttendanceFn,
    previewUndoBulkPresentFn,
    undoBulkPresentFn,
} from "@/server-functions/hr/attendance/bulk-mark-attendance-range-fn";

type BulkRange = Pick<BulkInput, "employeeIds" | "startDate" | "endDate">;

type BulkInput = {
    employeeIds: string[];
    startDate: string;
    endDate: string;
    template: {
        status: "present" | "absent" | "leave" | "holiday";
        leaveType?: "sick" | "annual" | "special" | null;
        notes?: string | null;
    };
    conflictStrategy: "skip" | "overwrite";
};

// Attendance changes pay, so every screen showing attendance or salary refreshes.
const BULK_QUERY_KEYS = [
    ["daily-attendance"],
    ["employee-attendance-log"],
    ["attendance-punches"],
    ["order-booker-activity-log"],
    ["salesman-activity-log"],
    ["driver-activity-log"],
    ["device-attendance"],
    ["time-exceptions"],
    ["pending-approval-counts"],
    ["bulk-attendance-preview"],
    ["leave-approvals"],
    ["overtime-approvals"],
    ["employees"],
    ["payrolls"],
    ["payroll"],
    ["payroll-dashboard"],
    ["payslip-preview"],
    ["employee-payroll-history"],
];

function useBulkMutation<Input>(
    mutationFn: (input: Input) => Promise<{ message: string }>,
    failure: string,
) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn,
        onSuccess: (result) => {
            toast.success(result.message);
            for (const queryKey of BULK_QUERY_KEYS)
                queryClient.invalidateQueries({ queryKey });
        },
        onError: (err: Error) => {
            toast.error(err.message || failure);
        },
    });
}

export const useBulkMarkAttendance = () =>
    useBulkMutation(
        (input: BulkInput) => bulkMarkAttendanceRangeFn({ data: input }),
        "Bulk mark failed",
    );

export const useUndoBulkPresent = () =>
    useBulkMutation(
        (input: BulkRange) => undoBulkPresentFn({ data: input }),
        "Undo failed",
    );

export function useUndoBulkPresentPreview(input: BulkRange | null) {
    return useQuery({
        queryKey: ["bulk-attendance-preview", "undo", input],
        queryFn: () => previewUndoBulkPresentFn({ data: input! }),
        enabled: input !== null,
        staleTime: 0,
        gcTime: 0,
        retry: false,
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
        gcTime: 0,
        retry: false,
    });
}
