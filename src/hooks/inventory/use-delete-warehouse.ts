import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteWarehouseFn } from "@/server-functions/inventory/delete-warehouse-fn";

export const useDeleteWarehouse = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteWarehouseFn,
    onSuccess: (data) => {
      toast.success(`Warehouse "${data.name}" permanently deleted`);
      queryClient.invalidateQueries({ queryKey: ["inventory-overview"] });
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete warehouse");
    },
  });
};
