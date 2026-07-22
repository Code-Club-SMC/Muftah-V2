import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";

export const useTransferStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: transferStockFn,
    onSuccess: () => {
      toast.success("Stock transferred successfully");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["factory-floor"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to transfer stock");
    },
  });
};
