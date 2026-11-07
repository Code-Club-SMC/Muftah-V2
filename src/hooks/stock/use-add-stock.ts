import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useAddStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addStockFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      toast.success("Stock added successfully");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add stock");
    },
  });
};
