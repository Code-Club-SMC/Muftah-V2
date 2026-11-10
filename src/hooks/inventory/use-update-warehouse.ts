import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateWarehouseFn } from "@/server-functions/inventory/update-warehouse-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useUpdateWarehouse = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateWarehouseFn,
    onSuccess: async (data) => {
      await invalidateStockQueries(queryClient);
      toast.success(`Warehouse "${data.name}" updated successfully`);
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-overview"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update warehouse");
    },
  });
};
