import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { getDashboardLastUpdateFn } from "../../server-functions/dashboard/get-dashboard-last-update-fn";

/**
 * Smart polling for the admin dashboard.
 * Only invalidates queries when server data actually changes,
 * preventing spurious re-renders and dialog dismissals.
 */
export const useDashboardSync = (startDate: string, endDate: string) => {
  const queryClient = useQueryClient();
  const lastUpdateRef = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["dashboard-sync"],
    queryFn: getDashboardLastUpdateFn,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  // Use callback to always get latest startDate/endDate without re-subscribing
  const invalidateDashboard = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard", startDate, endDate] });
  }, [queryClient, startDate, endDate]);

  useEffect(() => {
    const payload = data as { lastUpdated: string } | undefined;

    if (payload?.lastUpdated) {
      const newUpdate = new Date(payload.lastUpdated).toISOString();

      // Initial load — just store, do NOT invalidate
      if (lastUpdateRef.current === null) {
        lastUpdateRef.current = newUpdate;
        return;
      }

      // Only invalidate if something actually changed on the server
      if (lastUpdateRef.current !== newUpdate) {
        lastUpdateRef.current = newUpdate;
        invalidateDashboard();
      }
    }
  }, [data, invalidateDashboard]);
};
