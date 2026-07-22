import { useQuery } from "@tanstack/react-query";
import { getTerminalStatusFn } from "@/server-functions/hr/attendance/get-terminal-status-fn";

export const terminalStatusQueryKey = ["attendance-terminal", "status"] as const;

export function useTerminalStatus() {
  return useQuery({
    queryKey: terminalStatusQueryKey,
    queryFn: () => getTerminalStatusFn(),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}
