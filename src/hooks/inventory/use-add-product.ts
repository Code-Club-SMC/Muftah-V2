import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addProductFn } from "@/server-functions/inventory/add-product-fn";

export const useAddProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addProductFn,
    onSuccess: () => {
      toast.success("Product added successfully");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add product");
    },
  });
};
