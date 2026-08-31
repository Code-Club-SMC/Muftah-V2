import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getActivityTimelineFn,
  getActivityFilterOptionsFn,
  exportActivityTimelineFn,
  type ActivityTimelineInput,
} from "@/server-functions/dashboard/activity-timeline-fn";

// ── QUERY KEYS ─────────────────────────────────────────────────────────────

export const activityTimelineKeys = {
  all: ["activity-timeline"] as const,
  list: (params: Partial<ActivityTimelineInput>) =>
    [...activityTimelineKeys.all, "list", params] as const,
  filters: () => [...activityTimelineKeys.all, "filters"] as const,
  export: (params: Record<string, unknown>) =>
    [...activityTimelineKeys.all, "export", params] as const,
};

// ── HOOK: PAGINATED TIMELINE ───────────────────────────────────────────────

export function useActivityTimeline(params: Partial<ActivityTimelineInput>) {
  return useQuery({
    queryKey: activityTimelineKeys.list(params),
    queryFn: () =>
      getActivityTimelineFn({
        data: {
          page: params.page ?? 1,
          pageSize: params.pageSize ?? 50,
          module: params.module,
          action: params.action,
          actorId: params.actorId,
          entityType: params.entityType,
          severity: params.severity,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          search: params.search,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // 30-second polling
  });
}

// ── HOOK: FILTER OPTIONS ───────────────────────────────────────────────────

export function useActivityFilterOptions() {
  return useQuery({
    queryKey: activityTimelineKeys.filters(),
    queryFn: () => getActivityFilterOptionsFn(),
    staleTime: 60_000, // Options change rarely — cache for 1 minute
  });
}

// ── HOOK: EXPORT DATA ──────────────────────────────────────────────────────

export function useActivityExport(
  params: Record<string, string | undefined>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: activityTimelineKeys.export(params),
    queryFn: () =>
      exportActivityTimelineFn({
        data: {
          module: params.module,
          action: params.action,
          actorId: params.actorId,
          entityType: params.entityType,
          severity: params.severity,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          search: params.search,
        },
      }),
    enabled,
  });
}

// ── HOOK: CREATE MANUAL EVENT ──────────────────────────────────────────────

import { createManualActivityEventFn } from "@/server-functions/dashboard/activity-timeline-fn";

export function useCreateManualActivityEvent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: {
      module: string;
      action: string;
      entityType: string;
      severity: "info" | "warning" | "critical";
      description: string;
    }) => createManualActivityEventFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activityTimelineKeys.all });
    },
  });
}
