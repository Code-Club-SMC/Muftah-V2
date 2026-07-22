import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addPackagingMaterialFn } from "@/server-functions/inventory/add-packaging-material-fn";
import { toast } from "sonner";

export const useAddPackagingMaterial = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addPackagingMaterialFn,
    onSuccess: () => {
      toast.success("Packaging material added successfully");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add packaging material");
    },
  });
};
