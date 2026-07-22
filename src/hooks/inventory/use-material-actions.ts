import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteMaterialFn } from "@/server-functions/inventory/delete-material-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";
import { toast } from "sonner";

export const useDeleteMaterial = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMaterialFn,
    onSuccess: () => {
      toast.success("Material deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
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
    onSuccess: () => {
      toast.success("Material updated successfully");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update material");
    },
  });
};
