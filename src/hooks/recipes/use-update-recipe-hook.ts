import { updateRecipeFn } from "@/server-functions/inventory/recipes/update-recipe-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useUpdateRecipe = () => {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: updateRecipeFn,
    onSuccess: () => {
      toast.success("Recipe updated successfully");
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update recipe");
    },
  });

  return updateMutation;
};
