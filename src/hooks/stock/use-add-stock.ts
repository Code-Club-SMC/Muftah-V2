import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";

export const useAddStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addStockFn,
    onSuccess: () => {
      toast.success("Stock added successfully");
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-materials"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add stock");
    },
  });
};
