import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteProductionRunFn } from "@/server-functions/inventory/production/delete-production-run-fn";

export const useDeleteProductionRun = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: deleteProductionRunFn,
        onSuccess: () => {
            toast.success("Production run deleted successfully");
            queryClient.invalidateQueries({ queryKey: ["production-runs"] });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to delete production run");
        },
    });
};
