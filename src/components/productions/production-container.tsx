import { useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon, Search, Factory, TrendingUp, Package } from "lucide-react";
import { useState } from "react";
import { motion, Variants } from "framer-motion";

import { getPaginatedProductionRunsFn } from "@/server-functions/inventory/production/get-paginated-production-runs-fn";
import { GenericEmpty } from "../custom/empty";
import { InventoryEmptyIllustration } from "@/components/illustrations/InventoryEmptyIllustration";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ProductionRunsTable } from "./production-runs-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { InitiateProductionSheet } from "./initiate-production-sheet";
import { useProductionRunsSync } from "@/hooks/production/use-production-runs-sync";
import { cn } from "@/lib/utils";

// ── Animation Variants ─────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 30 },
  },
};

// ── Component ──────────────────────────────────────────────────────────────

export const ProductionRunsContainer = () => {
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  const { data } = useSuspenseQuery({
    queryKey: [
      "production-runs",
      {
        search: searchQuery,
        dateFilter,
        statusFilter,
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
      },
    ],
    queryFn: () =>
      getPaginatedProductionRunsFn({
        data: {
          search: searchQuery,
          dateFilter,
          statusFilter,
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
        },
      }),
  });

  const { runs, totalCount, metrics } = data;
  useProductionRunsSync();

  const isFilterActive =
    searchQuery !== "" || dateFilter !== "all" || statusFilter !== "all";

  if (totalCount === 0 && !isFilterActive) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <GenericEmpty
          icon={InventoryEmptyIllustration}
          title="No Production Runs Yet"
          description="Start your first production run to begin manufacturing. The system will automatically calculate costs and deduct materials."
          ctaText="Start Production Run"
          onAddChange={setCreateDialogOpen}
        />
        <InitiateProductionSheet
          open={isCreateDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </motion.div>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6">
      {/* Header Actions */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1 w-full">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by batch ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 rounded-none shadow-none focus-visible:ring-1 focus-visible:ring-primary border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-full sm:w-[150px] rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
                <SelectValue placeholder="Date Filter" />
              </SelectTrigger>
              <SelectContent className="rounded-none shadow-none border border-border">
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                <SelectItem value="this_month">This Month</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px] rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
                <SelectValue placeholder="Status Filter" />
              </SelectTrigger>
              <SelectContent className="rounded-none shadow-none border border-border">
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="w-full sm:w-auto">
          <PlusIcon className="size-4 mr-2" />
          New Production Run
        </Button>
      </motion.div>

      {/* Sharp KPI Cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SharpKPICard
          label="Active Runs"
          value={metrics.activeRuns.toString()}
          icon={Factory}
          theme="blue"
        />
        <SharpKPICard
          label="Total Production Cost"
          value={`PKR ${Number(metrics.totalCost || 0).toLocaleString("en-PK")}`}
          icon={TrendingUp}
          theme="emerald"
        />
        <SharpKPICard
          label="Packs Produced"
          value={Number(metrics.packsProduced || 0).toLocaleString()}
          icon={Package}
          theme="violet"
        />
      </motion.div>

      {/* Table */}
      <motion.div variants={itemVariants} className="bg-card border border-border rounded-none shadow-none">
        <ProductionRunsTable
          runs={runs}
          manualPagination={true}
          pageCount={Math.ceil(totalCount / pagination.pageSize)}
          pagination={pagination}
          onPaginationChange={setPagination}
          totalRecords={totalCount}
        />
      </motion.div>

      <InitiateProductionSheet open={isCreateDialogOpen} onOpenChange={setCreateDialogOpen} />
    </motion.div>
  );
};

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

interface SharpKPICardProps {
  label: string;
  value: string;
  icon: any;
  theme: "blue" | "rose" | "emerald" | "violet";
  subtext?: string;
}

const sharpThemeStyles = {
  blue: { border: "border-t-blue-500", iconBg: "bg-blue-500/10", iconText: "text-blue-500" },
  rose: { border: "border-t-rose-500", iconBg: "bg-rose-500/10", iconText: "text-rose-500" },
  emerald: { border: "border-t-emerald-500", iconBg: "bg-emerald-500/10", iconText: "text-emerald-500" },
  violet: { border: "border-t-violet-500", iconBg: "bg-violet-500/10", iconText: "text-violet-500" },
};

function SharpKPICard({ label, value, icon: Icon, theme, subtext }: SharpKPICardProps) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{ backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`, backgroundSize: "8px 8px" }}
      />
      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>
      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground">{value}</h3>
        {subtext ? <p className="text-xs font-medium text-muted-foreground/70">{subtext}</p> : <div className="h-4" />}
      </div>
    </motion.div>
  );
}