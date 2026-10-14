import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createFormulaFn } from "@/server-functions/manufacturing/formulas/create-formula-fn";
import { updateFormulaFn } from "@/server-functions/manufacturing/formulas/update-formula-fn";
import { deleteFormulaFn } from "@/server-functions/manufacturing/formulas/delete-formula-fn";

export const useCreateFormula = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createFormulaFn,
    onSuccess: () => {
      toast.success("Mixing Formula created successfully");
      queryClient.invalidateQueries({ queryKey: ["formulas"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create mixing formula");
    },
  });
};

export const useUpdateFormula = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateFormulaFn,
    onSuccess: (data) => {
      toast.success("Mixing Formula updated successfully");
      queryClient.invalidateQueries({ queryKey: ["formulas"] });
      queryClient.invalidateQueries({ queryKey: ["formula", data.id] });
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update mixing formula");
    },
  });
};

export const useDeleteFormula = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteFormulaFn,
    onSuccess: (data) => {
      toast.success("Mixing Formula deactivated successfully");
      queryClient.invalidateQueries({ queryKey: ["formulas"] });
      queryClient.invalidateQueries({ queryKey: ["formula", data.formula.id] });
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-packaging"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to deactivate mixing formula");
    },
  });
};
