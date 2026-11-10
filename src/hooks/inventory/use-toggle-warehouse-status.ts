import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toggleWarehouseStatusFn } from "@/server-functions/inventory/toggle-warehouse-status-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useToggleWarehouseStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleWarehouseStatusFn,
    onSuccess: async (_, variables) => {
      await invalidateStockQueries(queryClient);
      const action = variables.data.isActive ? "activated" : "deactivated";
      toast.success(`Warehouse ${action} successfully`);
      queryClient.invalidateQueries({ queryKey: ["inventory-overview"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update warehouse status");
    },
  });
};
