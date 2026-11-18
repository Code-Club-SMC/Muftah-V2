import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLabReportFn } from "@/server-functions/inventory/lab-reports/create-lab-report-fn";
import {
    getLabReportsFn,
    getLabReportByIdFn,
} from "@/server-functions/inventory/lab-reports/get-lab-reports-fn";
import { deleteLabReportFn } from "@/server-functions/inventory/lab-reports/delete-lab-report-fn";
import { updateLabReportFn } from "@/server-functions/inventory/lab-reports/update-lab-report-fn";
import { getChemicalReportPurchasesFn } from "@/server-functions/inventory/lab-reports/get-chemical-report-purchases-fn";

export const useLabReports = (chemicalId: string, purchaseId?: string) => {
    return useQuery({
        queryKey: ["lab-reports", chemicalId, purchaseId ?? "all"],
        queryFn: () => getLabReportsFn({ data: { chemicalId, purchaseId } }),
        enabled: !!chemicalId,
    });
};

export const useChemicalReportPurchases = (chemicalId: string) => useQuery({
    queryKey: ["chemical-report-purchases", chemicalId],
    queryFn: () => getChemicalReportPurchasesFn({ data: { chemicalId } }),
    enabled: !!chemicalId,
});

async function invalidateReports(queryClient: QueryClient) {
    await Promise.all(["lab-reports", "lab-report", "chemical-report-purchases", "purchase-edit-state", "factory-floor", "inventory", "item-detail"]
        .map(prefix => queryClient.invalidateQueries({ queryKey: [prefix] })));
}

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
        onSuccess: async () => {
            await invalidateReports(queryClient);
            toast.success("Lab report created successfully");
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
        onSuccess: async () => {
            await invalidateReports(queryClient);
            toast.success("Lab report updated successfully");
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
        onSuccess: async (_data, variables) => {
            queryClient.removeQueries({ queryKey: ["lab-report", variables.data.reportId], exact: true });
            await invalidateReports(queryClient);
            toast.success("Lab report deleted successfully");
        },
        onError: (error) => {
            toast.error(error.message || "Failed to delete lab report");
        },
    });
};
