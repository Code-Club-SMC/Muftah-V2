import { createRecipeFn } from "@/server-functions/inventory/recipes/create-recipe-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useCreateRecipe = () => {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: createRecipeFn,
    onSuccess: () => {
      toast.success("Recipe created successfully");
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create recipe");
    },
  });

  return createMutation;
};
