import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLabReportFn } from "@/server-functions/inventory/lab-reports/create-lab-report-fn";
import {
    getLabReportsFn,
    getLabReportByIdFn,
} from "@/server-functions/inventory/lab-reports/get-lab-reports-fn";
import { deleteLabReportFn } from "@/server-functions/inventory/lab-reports/delete-lab-report-fn";
import { updateLabReportFn } from "@/server-functions/inventory/lab-reports/update-lab-report-fn";

export const useLabReports = (chemicalId: string) => {
    return useQuery({
        queryKey: ["lab-reports", chemicalId],
        queryFn: () => getLabReportsFn({ data: { chemicalId } }),
        enabled: !!chemicalId,
    });
};

export const useLabReport = (reportId: string) => {
    return useQuery({
        queryKey: ["lab-report", reportId],
        queryFn: () => getLabReportByIdFn({ data: { reportId } }),
        enabled: !!reportId,
    });
};

export const useCreateLabReport = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createLabReportFn,
        onSuccess: (_data, variables) => {
            toast.success("Lab report created successfully");
            queryClient.invalidateQueries({
                queryKey: ["lab-reports", variables.data.chemicalId],
            });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to create lab report");
        },
    });
};

export const useUpdateLabReport = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: updateLabReportFn,
        onSuccess: () => {
            toast.success("Lab report updated successfully");
            queryClient.invalidateQueries({ queryKey: ["lab-reports"] });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to update lab report");
        },
    });
};

export const useDeleteLabReport = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: deleteLabReportFn,
        onSuccess: () => {
            toast.success("Lab report deleted successfully");
            queryClient.invalidateQueries({ queryKey: ["lab-reports"] });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to delete lab report");
        },
    });
};
