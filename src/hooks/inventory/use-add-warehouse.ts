import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addWarehouseFn } from "@/server-functions/inventory/add-warehouse.fn";
import { toast } from "sonner";

export const useAddWarehouse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addWarehouseFn,
    onSuccess: () => {
      // toast.success("Warehouse added successfully");
      // Invalidate all warehouse-related queries
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add warehouse");
    },
  });
};
