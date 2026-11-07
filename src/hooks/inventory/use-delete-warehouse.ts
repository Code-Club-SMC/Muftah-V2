import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteWarehouseFn } from "@/server-functions/inventory/delete-warehouse-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useDeleteWarehouse = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteWarehouseFn,
    onSuccess: async (data) => {
      await invalidateStockQueries(queryClient);
      toast.success(`Warehouse "${data.name}" permanently deleted`);
      queryClient.invalidateQueries({ queryKey: ["inventory-overview"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete warehouse");
    },
  });
};
