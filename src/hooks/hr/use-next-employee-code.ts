import { generateNextEmployeeCodeFn } from "@/server-functions/hr/employees/generate-employee-code-fn";
import { useQuery } from "@tanstack/react-query";

/**
 * Fetches the next auto-generated employee code (e.g. EMP-0001) for preview in the form.
 */
export const useNextEmployeeCode = () => {
  return useQuery({
    queryKey: ["next-employee-code"],
    queryFn: () => generateNextEmployeeCodeFn(),
    staleTime: 30_000, // 30 seconds — code won't change rapidly
    gcTime: 60_000,
  });
};
