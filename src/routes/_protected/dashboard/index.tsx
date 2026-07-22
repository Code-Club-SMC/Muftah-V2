import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard } from "lucide-react";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard-container";
import { motion } from "framer-motion";

export const Route = createFileRoute("/_protected/dashboard/")({
  component: AdminDashboardPage,
});

function AdminDashboardPage() {
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
            <LayoutDashboard className="size-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black uppercase  leading-none text-foreground">
                Command Center
              </h2>
              <Badge
                variant="outline"
                className="text-[9px] font-bold uppercase  bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 rounded-none px-2 py-0 h-5 gap-1.5"
              >
                <span className="size-1.5 bg-emerald-500 rounded-none animate-pulse" />
                Live System
              </Badge>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase  mt-2">
              Real-time operations, finances, and production telemetry
            </p>
          </div>
        </div>
      </motion.div>

      <Suspense
        fallback={
          <div className="p-12 border border-border bg-card">
            <GenericLoader
              title="Initializing Telemetry"
              description="Aggregating dashboard data..."
            />
          </div>
        }
      >
        <AdminDashboard />
      </Suspense>
    </div>
  );
}