import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteRecipeFn } from "@/server-functions/inventory/recipes/delete-recipe-fn";

export const useDeleteRecipe = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteRecipeFn,
    onSuccess: (result) => {
      toast.success(result.archived ? "Format archived. Existing records are kept." : "Unused format removed.");
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["batch-packing"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-format-options"] });
      queryClient.invalidateQueries({ queryKey: ["recipe"] });
      queryClient.invalidateQueries({ queryKey: ["formula"] });
      queryClient.invalidateQueries({ queryKey: ["mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-allocations"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete packaging format");
    },
  });
};
