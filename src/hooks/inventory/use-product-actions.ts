import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteProductFn } from "@/server-functions/inventory/delete-product-fn";
import { updateProductFn } from "@/server-functions/inventory/update-product-fn";

export const useProductActions = () => {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: deleteProductFn,
    onSuccess: () => {
      toast.success("Product deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete product");
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateProductFn,
    onSuccess: (updated) => {
      toast.success("Product updated successfully");
      // Show the saved values at once; the full refetch below recalculates costs and is slow.
      if (updated)
        queryClient.setQueriesData<{ id: string }[]>(
          { queryKey: ["products"] },
          (rows) =>
            rows?.map((row) =>
              row.id === updated.id ? { ...row, ...updated } : row,
            ),
        );
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-detail"] });
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update product");
    },
  });

  return {
    deleteProduct: deleteMutation,
    updateProduct: updateMutation,
  };
};
