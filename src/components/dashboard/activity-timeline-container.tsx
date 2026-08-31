import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { RefreshCw, Activity, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenericLoader } from "@/components/custom/generic-loader";
import { GenericEmpty } from "@/components/custom/empty";
import { format, isToday, isYesterday, parseISO, startOfDay, endOfDay } from "date-fns";
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
import { ActivityDetailSheet } from "./activity-detail-sheet";
import { exportActivityTimelineFn } from "@/server-functions/dashboard/activity-timeline-fn";
import { toast } from "sonner";

// ── CSV EXPORT UTILITY ─────────────────────────────────────────────────────

function downloadCsv(events: Array<Record<string, unknown>>, filename: string) {
  if (events.length === 0) return;

  const headers = [
    "Timestamp",
    "Department",
    "Action",
    "Entity Type",
    "Entity ID",
    "Entity Label",
    "Operator",
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
    transition: { staggerChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

function formatDateGroupHeader(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMMM d, yyyy");
}

export function ActivityTimelineContainer() {
  const queryClient = useQueryClient();
  
  // Default to today's events on initial load
  const [filters, setFilters] = useState<ActivityFilters>(() => {
    const today = new Date();
    return {
      dateFrom: startOfDay(today).toISOString(),
      dateTo: endOfDay(today).toISOString(),
    };
  });

  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);

  const { data, isLoading, isFetching } = useActivityTimeline({
    page,
    pageSize: 50,
    ...filters,
  });

  const { data: filterOptions } = useActivityFilterOptions();

  const handleFiltersChange = useCallback((newFilters: ActivityFilters) => {
    setFilters(newFilters);
    setPage(1);
  }, []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: activityTimelineKeys.all });
    toast.info("Timeline synchronized with server");
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
      const filename = `activity-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(result.events as Array<Record<string, unknown>>, filename);
      toast.success("Audit Log Exported", {
        description: `${result.events.length} records downloaded.`,
      });
    } catch {
      toast.error("Export Failed", {
        description: "Could not export audit log. Try again.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const events = (data?.events ?? []) as ActivityEvent[];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  // Group events by date (YYYY-MM-DD)
  const groupedEvents = useMemo(() => {
    const groups: Record<string, ActivityEvent[]> = {};
    for (const event of events) {
      const dateKey = format(new Date(event.timestamp), "yyyy-MM-dd");
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(event);
    }
    return groups;
  }, [events]);

  const dateKeys = Object.keys(groupedEvents);

  return (
    <div className="space-y-5">
      {/* ── Filter Toolbar ──────────────────────────────────────────── */}
      <ActivityTimelineFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        filterOptions={filterOptions}
        isLoading={isLoading}
        onExport={handleExport}
        isExporting={isExporting}
      />

      {/* ── Sub-header: Feed Stats & Sync Status ────────────────────── */}
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium">
          {total > 0 && (
            <span>
              {total.toLocaleString()} record{total !== 1 ? "s" : ""}
            </span>
          )}
          {isFetching && !isLoading && (
            <span className="flex items-center gap-1.5 text-primary">
              <span className="size-1.5 rounded-full bg-primary animate-ping" />
              Syncing
            </span>
          )}
        </div>

        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground font-medium transition-colors cursor-pointer"
        >
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin text-primary" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Main Activity Feed ──────────────────────────────────────── */}
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-card p-12 shadow-xs">
          <GenericLoader
            title="Loading Activity Stream"
            description="Fetching today's system events..."
          />
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-card p-12 shadow-xs text-center">
          <GenericEmpty
            icon={Activity}
            title="No Activity Today"
            description={
              Object.values(filters).some(Boolean)
                ? "No events recorded for today matching your filter criteria. Try clicking 'All Time' or selecting a date range."
                : "No system events have been recorded today yet."
            }
          />
        </div>
      ) : (
        <div className="space-y-8 pt-1">
          {dateKeys.map((dateKey) => {
            const dayEvents = groupedEvents[dateKey];
            return (
              <div key={dateKey} className="space-y-4">
                {/* Date Group Heading */}
                <div className="sticky top-16 z-10 flex items-center gap-3 py-1 bg-slate-50/90 dark:bg-background/90 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    <CalendarDays className="size-3.5 text-slate-400" />
                    <span>{formatDateGroupHeader(dateKey)}</span>
                  </div>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Events in this Date Group */}
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-0"
                >
                  <AnimatePresence mode="popLayout">
                    {dayEvents.map((event, idx) => (
                      <motion.div key={event.id} variants={itemVariants} layout>
                        <ActivityEventCard
                          event={event}
                          isLast={idx === dayEvents.length - 1}
                          onSelect={(e) => setSelectedEvent(e)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-6 border-t border-slate-200/80 dark:border-slate-800">
          <span className="text-xs text-muted-foreground font-medium">
            Page <span className="font-semibold text-foreground">{page}</span> of{" "}
            <span className="font-semibold text-foreground">{totalPages}</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 px-3 text-xs bg-white dark:bg-card border-slate-200/80 dark:border-slate-800 shadow-xs"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-8 px-3 text-xs bg-white dark:bg-card border-slate-200/80 dark:border-slate-800 shadow-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Event Detail Drawer ─────────────────────────────────────── */}
      <ActivityDetailSheet
        event={selectedEvent}
        open={!!selectedEvent}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
      />
    </div>
  );
}
