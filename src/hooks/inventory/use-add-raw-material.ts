import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addRawMaterialFn as addChemicalFn } from "@/server-functions/inventory/add-chemical-fn";
import { toast } from "sonner";

export const useAddChemical = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addChemicalFn,
    onSuccess: () => {
      toast.success("Chemical added successfully");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
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
