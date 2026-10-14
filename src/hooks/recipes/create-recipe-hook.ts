import { createRecipeFn } from "@/server-functions/inventory/recipes/create-recipe-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useCreateRecipe = () => {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: createRecipeFn,
    onSuccess: () => {
      toast.success("Packaging Format created successfully");
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
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create packaging format");
    },
  });

  return createMutation;
};
