import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { ActivityTimelineContainer } from "@/components/dashboard/activity-timeline-container";
import { motion } from "framer-motion";

export const Route = createFileRoute("/_protected/dashboard/activity-timeline/")({
  component: ActivityTimelinePage,
});

function ActivityTimelinePage() {
  return (
    <div className="space-y-6 font-sans antialiased bg-background min-h-screen pb-10">
      {/* ── Sharp Technical Header ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative flex items-center justify-between p-6 border border-border bg-card shadow-none overflow-hidden"
      >
        {/* Technical Grid Pattern */}
        <div
          className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`, backgroundSize: "8px 8px" }}
        />

        <div className="relative z-10 flex items-center gap-4">
          <div className="p-2.5 bg-primary/10 border border-primary/20">
            <Activity className="size-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black uppercase leading-none text-foreground">
                Activity Timeline
              </h2>
              <Badge
                variant="outline"
                className="text-[9px] font-bold uppercase bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400 rounded-none px-2 py-0 h-5 gap-1.5"
              >
                System Audit
              </Badge>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase mt-2">
              System-wide immutable audit log of all mutations and critical events
            </p>
          </div>
        </div>
      </motion.div>

      <Suspense
        fallback={
          <div className="p-12 border border-border bg-card">
            <GenericLoader
              title="Initializing Timeline"
              description="Loading system activity events..."
            />
          </div>
        }
      >
        <div className="px-6">
          <ActivityTimelineContainer />
        </div>
      </Suspense>
    </div>
  );
}
