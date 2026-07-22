import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateEmployeeFn } from "@/server-functions/hr/employees/update-employee-fn";
import { toast } from "sonner";

export const useUpdateEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEmployeeFn,
    onSuccess: (data) => {
      toast.success("Employee updated successfully");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee", data.id] });
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to update employee");
    },
  });
};
