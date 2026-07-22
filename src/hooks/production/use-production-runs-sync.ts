import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getProductionRunsLastUpdateFn } from "@/server-functions/inventory/production/get-production-runs-last-update-fn";

export const useProductionRunsSync = () => {
  const queryClient = useQueryClient();
  const lastUpdateRef = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["production-runs-sync"],
    queryFn: getProductionRunsLastUpdateFn,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (data?.lastUpdated) {
      const newUpdate = new Date(data.lastUpdated).toISOString();

      // Initial load - don't invalidate, just set ref
      if (lastUpdateRef.current === null) {
        lastUpdateRef.current = newUpdate;
        return;
      }

      // Subsequent updates - if different, invalidate
      if (lastUpdateRef.current !== newUpdate) {
        lastUpdateRef.current = newUpdate;

        // Invalidate all related queries
        queryClient.invalidateQueries({ queryKey: ["operator-production-runs"] });
        queryClient.invalidateQueries({ queryKey: ["production-runs"] });
        // Also invalidate active run specific queries if needed
        queryClient.invalidateQueries({ queryKey: ["production-run"] });
      }
    }
  }, [data, queryClient]);
};
