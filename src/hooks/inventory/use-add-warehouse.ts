import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addWarehouseFn } from "@/server-functions/inventory/add-warehouse.fn";
import { toast } from "sonner";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useAddWarehouse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addWarehouseFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      // toast.success("Warehouse added successfully");
      // Invalidate all warehouse-related queries
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add warehouse");
    },
  });
};
