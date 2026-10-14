import { updateRecipeFn } from "@/server-functions/inventory/recipes/update-recipe-fn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useUpdateRecipe = () => {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: updateRecipeFn,
    onSuccess: () => {
      toast.success("Packaging Format updated successfully");
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
      toast.error(error.message || "Failed to update packaging format");
    },
  });

  return updateMutation;
};
