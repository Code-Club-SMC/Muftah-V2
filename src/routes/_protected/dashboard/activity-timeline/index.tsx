import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { ActivityTimelineContainer } from "@/components/dashboard/activity-timeline-container";
import { Activity } from "lucide-react";

export const Route = createFileRoute("/_protected/dashboard/activity-timeline/")({
  component: ActivityTimelinePage,
});

function ActivityTimelinePage() {
  return (
    <div className="space-y-6 font-sans antialiased min-h-screen pb-16 px-6 pt-6 max-w-6xl mx-auto">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 mt-0.5">
            <Activity className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-foreground">
                Activity Timeline
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Sync
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Real-time audit log of actions, approvals, financial entries, and operational movements across all departments.
            </p>
          </div>
        </div>
      </div>

      {/* ── Timeline Stream ─────────────────────────────────────────── */}
      <Suspense
        fallback={
          <div className="p-12 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-card">
            <GenericLoader
              title="Initializing Timeline"
              description="Loading audit events..."
            />
          </div>
        }
      >
        <ActivityTimelineContainer />
      </Suspense>
    </div>
  );
}
