import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteRecipeFn } from "@/server-functions/inventory/recipes/delete-recipe-fn";

export const useDeleteRecipe = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteRecipeFn,
    onSuccess: () => {
      toast.success("Recipe deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => {
      // Show toast for all errors — the card component will also handle
      // the force-delete upgrade via the error message
      toast.error(error.message || "Failed to delete recipe");
    },
  });
};
