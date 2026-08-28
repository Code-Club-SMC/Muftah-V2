import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { ActivityTimelineContainer } from "@/components/dashboard/activity-timeline-container";

export const Route = createFileRoute("/_protected/dashboard/activity-timeline/")({
  component: ActivityTimelinePage,
});

function ActivityTimelinePage() {
  return (
    <div className="w-full min-h-screen bg-background/50">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-6 max-w-7xl mx-auto w-full">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Activity Timeline
            </h1>
            <p className="text-xs text-muted-foreground font-medium">
              System-wide immutable audit log of all mutations and critical events.
            </p>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto w-full px-6 py-8">
        <Suspense
          fallback={
            <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-border/40 bg-card/20 shadow-sm">
              <GenericLoader
                title="Loading Timeline..."
                description="Fetching system activity events from the database."
              />
            </div>
          }
        >
          <ActivityTimelineContainer />
        </Suspense>
      </main>
    </div>
  );
}
