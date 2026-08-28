import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { RefreshCw, Activity, Layers } from "lucide-react";
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
  const headers = ["Timestamp", "Module", "Action", "Entity Type", "Entity ID", "Entity Label", "Actor", "Description", "Severity", "IP Address"];
  const rows = events.map((e) => [
    e.timestamp ? new Date(e.timestamp as string).toISOString() : "",
    e.module ?? "", e.action ?? "", e.entityType ?? "", e.entityId ?? "", e.entityLabel ?? "", e.actorName ?? "",
    `"${String(e.description ?? "").replace(/"/g, '""')}"`, e.severity ?? "", e.ipAddress ?? "",
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
  visible: { opacity: 1, transition: { staggerChildren: 0.02 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

// ── COMPONENT ──────────────────────────────────────────────────────────────

export function ActivityTimelineContainer() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, isFetching } = useActivityTimeline({ page, pageSize: 50, ...filters });
  const { data: filterOptions } = useActivityFilterOptions();

  const handleFiltersChange = useCallback((newFilters: ActivityFilters) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: activityTimelineKeys.all });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportActivityTimelineFn({ data: { ...filters } });
      const filename = `activity-timeline-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(result.events as Array<Record<string, unknown>>, filename);
      toast.success("Activity log exported", { description: `${result.events.length} events exported to CSV.` });
    } catch {
      toast.error("Export failed", { description: "Could not generate the CSV export." });
    } finally {
      setIsExporting(false);
    }
  };

  const events = (data?.events ?? []) as ActivityEvent[];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-sm text-muted-foreground font-medium">
          {total > 0 && <span>{total.toLocaleString()} events matching criteria</span>}
          {isFetching && !isLoading && (
            <span className="flex items-center gap-1.5 text-primary/70 animate-pulse">
              <RefreshCw className="size-3.5 animate-spin" /> Syncing...
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-8 px-3 gap-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="size-3.5" />
          Refresh feed
        </Button>
      </div>

      <ActivityTimelineFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        filterOptions={filterOptions}
        isLoading={isLoading}
        onExport={handleExport}
        isExporting={isExporting}
      />

      <div className="rounded-xl border border-border/40 bg-card p-6 shadow-sm min-h-[400px]">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <GenericLoader title="Loading Timeline" description="Fetching system activity..." />
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center">
            <GenericEmpty
              icon={Layers}
              title="No events found"
              description={Object.values(filters).some(Boolean) ? "Try adjusting your filters to see more results." : "System activity will appear here."}
            />
          </div>
        ) : (
          <div className="flex flex-col">
            <motion.div variants={containerVariants} initial="hidden" animate="visible" className="pl-2 pt-2">
              <AnimatePresence mode="popLayout">
                {events.map((event, idx) => (
                  <motion.div key={event.id} variants={itemVariants} layout>
                    <ActivityEventCard event={event} isLast={idx === events.length - 1} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-between pt-6 border-t border-border/40">
                <span className="text-sm text-muted-foreground">
                  Showing page <span className="font-medium text-foreground">{page}</span> of <span className="font-medium text-foreground">{totalPages}</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="h-8 w-24">
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="h-8 w-24">
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
