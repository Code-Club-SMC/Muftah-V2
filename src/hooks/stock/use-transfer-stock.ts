import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useTransferStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: transferStockFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      toast.success("Stock transferred successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to transfer stock");
    },
  });
};
