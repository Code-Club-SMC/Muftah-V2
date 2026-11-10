import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addRawMaterialFn as addChemicalFn } from "@/server-functions/inventory/add-chemical-fn";
import { toast } from "sonner";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const useAddChemical = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addChemicalFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      toast.success("Chemical added successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add chemical");
    },
  });
};
