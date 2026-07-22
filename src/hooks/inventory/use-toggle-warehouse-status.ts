import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toggleWarehouseStatusFn } from "@/server-functions/inventory/toggle-warehouse-status-fn";

export const useToggleWarehouseStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleWarehouseStatusFn,
    onSuccess: (_, variables) => {
      const action = variables.data.isActive ? "activated" : "deactivated";
      toast.success(`Warehouse ${action} successfully`);
      queryClient.invalidateQueries({ queryKey: ["inventory-overview"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update warehouse status");
    },
  });
};
