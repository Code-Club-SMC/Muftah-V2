import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createProductionLabReportFn } from "@/server-functions/inventory/production/lab-reports/create-production-lab-report-fn";
import {
    getProductionLabReportsFn,
    getProductionLabReportByIdFn,
} from "@/server-functions/inventory/production/lab-reports/get-production-lab-reports-fn";
import { deleteProductionLabReportFn } from "@/server-functions/inventory/production/lab-reports/delete-production-lab-report-fn";
import { updateProductionLabReportFn } from "@/server-functions/inventory/production/lab-reports/update-production-lab-report-fn";

export const useProductionLabReports = (productionRunId: string) => {
    return useQuery({
        queryKey: ["production-lab-reports", productionRunId],
        queryFn: () =>
            getProductionLabReportsFn({ data: { productionRunId } }),
        enabled: !!productionRunId,
    });
};

export const useProductionLabReport = (reportId: string) => {
    return useQuery({
        queryKey: ["production-lab-report", reportId],
        queryFn: () => getProductionLabReportByIdFn({ data: { reportId } }),
        enabled: !!reportId,
    });
};

export const useCreateProductionLabReport = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createProductionLabReportFn,
        onSuccess: (_data, variables) => {
            toast.success("Production lab report created successfully");
            queryClient.invalidateQueries({
                queryKey: [
                    "production-lab-reports",
                    variables.data.productionRunId,
                ],
            });
        },
        onError: (error) => {
            toast.error(
                error.message || "Failed to create production lab report",
            );
        },
    });
};

export const useUpdateProductionLabReport = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: updateProductionLabReportFn,
        onSuccess: () => {
            toast.success("Production lab report updated successfully");
            queryClient.invalidateQueries({
                queryKey: ["production-lab-reports"],
            });
        },
        onError: (error) => {
            toast.error(
                error.message || "Failed to update production lab report",
            );
        },
    });
};

export const useDeleteProductionLabReport = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: deleteProductionLabReportFn,
        onSuccess: () => {
            toast.success("Production lab report deleted successfully");
            queryClient.invalidateQueries({
                queryKey: ["production-lab-reports"],
            });
        },
        onError: (error) => {
            toast.error(
                error.message || "Failed to delete production lab report",
            );
        },
    });
};
