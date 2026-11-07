import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteMaterialFn } from "@/server-functions/inventory/delete-material-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";
import { toast } from "sonner";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useDeleteMaterial = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMaterialFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      toast.success("Material deleted successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete material");
    },
  });
};

export const useUpdateMaterial = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMaterialFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      toast.success("Material updated successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update material");
    },
  });
};
