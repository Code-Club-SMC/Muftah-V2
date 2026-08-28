import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenericLoader } from "@/components/custom/generic-loader";
import { GenericEmpty } from "@/components/custom/empty";
import {
  useActivityTimeline,
  useActivityFilterOptions,
  activityTimelineKeys,
} from "@/hooks/dashboard/use-activity-timeline";
import {
  ActivityTimelineFilters,
  type ActivityFilters,
} from "./activity-timeline-filters";
import { ActivityEventCard, type ActivityEvent } from "./activity-event-card";
import { exportActivityTimelineFn } from "@/server-functions/dashboard/activity-timeline-fn";
import { toast } from "sonner";

// ── CSV EXPORT UTILITY ─────────────────────────────────────────────────────

function downloadCsv(events: Array<Record<string, unknown>>, filename: string) {
  if (events.length === 0) return;

  const headers = [
    "Timestamp",
    "Module",
    "Action",
    "Entity Type",
    "Entity ID",
    "Entity Label",
    "Actor",
    "Description",
    "Severity",
    "IP Address",
  ];

  const rows = events.map((e) => [
    e.timestamp ? new Date(e.timestamp as string).toISOString() : "",
    e.module ?? "",
    e.action ?? "",
    e.entityType ?? "",
    e.entityId ?? "",
    e.entityLabel ?? "",
    e.actorName ?? "",
    `"${String(e.description ?? "").replace(/"/g, '""')}"`,
    e.severity ?? "",
    e.ipAddress ?? "",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ── ANIMATION VARIANTS ─────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

// ── COMPONENT ──────────────────────────────────────────────────────────────

export function ActivityTimelineContainer() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, isFetching } = useActivityTimeline({
    page,
    pageSize: 50,
    ...filters,
  });

  const { data: filterOptions } = useActivityFilterOptions();

  const handleFiltersChange = useCallback((newFilters: ActivityFilters) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page on filter change
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: activityTimelineKeys.all });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportActivityTimelineFn({
        data: {
          module: filters.module,
          action: filters.action,
          actorId: filters.actorId,
          entityType: filters.entityType,
          severity: filters.severity,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          search: filters.search,
        },
      });
      const filename = `activity-timeline-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(result.events as Array<Record<string, unknown>>, filename);
      toast.success("Activity log exported", {
        description: `${result.events.length} events exported to CSV.`,
      });
    } catch {
      toast.error("Export failed", {
        description: "Could not generate the CSV export. Try again.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const events = (data?.events ?? []) as ActivityEvent[];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono tabular-nums">
          {total > 0 && (
            <span>
              {total.toLocaleString()} event{total !== 1 ? "s" : ""}
            </span>
          )}
          {isFetching && !isLoading && (
            <span className="flex items-center gap-1 text-primary/60">
              <RefreshCw className="size-3 animate-spin" />
              Syncing
            </span>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="h-8 px-3 gap-1.5 border-dashed text-xs"
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <ActivityTimelineFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        filterOptions={filterOptions}
        isLoading={isLoading}
        onExport={handleExport}
        isExporting={isExporting}
      />

      {/* Timeline */}
      {isLoading ? (
        <div className="border border-border bg-card/50 rounded-lg p-12">
          <GenericLoader
            title="Loading Activity Timeline"
            description="Fetching system events..."
          />
        </div>
      ) : events.length === 0 ? (
        <div className="border border-border bg-card/50 rounded-lg p-12">
          <GenericEmpty
            icon={Activity}
            title="No activity events"
            description={
              Object.values(filters).some(Boolean)
                ? "No events match your current filters. Try adjusting the filter criteria."
                : "System activity events will appear here as users perform actions across the ERP."
            }
          />
        </div>
      ) : (
        <>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="relative"
          >
            <AnimatePresence mode="popLayout">
              {events.map((event, idx) => (
                <motion.div
                  key={event.id}
                  variants={itemVariants}
                  layout
                >
                  <ActivityEventCard
                    event={event}
                    isLast={idx === events.length - 1}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-7 px-3 text-xs"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-7 px-3 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
