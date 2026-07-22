import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getDashboardStatsFn } from "@/server-functions/dashboard/get-dashboard-fn";
import { DashboardKpiCards } from "@/components/dashboard/dashboard-kpi-cards";
import { RevenueExpenseChart } from "@/components/dashboard/revenue-expense-chart";
import { CapitalAllocationChart } from "@/components/dashboard/capital-allocation-chart";
import { RecentActivityFeed } from "@/components/dashboard/recent-activity-feed";
import { Button } from "@/components/ui/button";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  RefreshCw,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  HardDrive,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { useDashboardSync } from "@/hooks/dashboard/use-dashboard-sync";
import { motion, Variants } from "framer-motion";
import type { DateRange } from "react-day-picker";

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

export function AdminDashboard() {
  const queryClient = useQueryClient();

  // Default to current month
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });

  const startDate =
    dateRange.from?.toISOString() ?? startOfMonth(today).toISOString();
  const endDate =
    dateRange.to?.toISOString() ?? endOfMonth(today).toISOString();

  const { data, isFetching } = useSuspenseQuery({
    queryKey: ["admin-dashboard", startDate, endDate],
    queryFn: () => getDashboardStatsFn({ data: { startDate, endDate } }),
    staleTime: 0,
    gcTime: 0,
  });

  useDashboardSync(startDate, endDate);

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["admin-dashboard", startDate, endDate],
    });
  };

  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (range?.from) {
      setDateRange({
        from: range.from,
        to: range.to ?? range.from,
      });
    } else {
      // Reset to current month when cleared
      setDateRange({
        from: startOfMonth(today),
        to: endOfMonth(today),
      });
    }
  };

  const netProfitPositive = data.netProfit >= 0;

  const displayRange =
    dateRange.to && dateRange.from
      ? `${format(dateRange.from, "dd MMM yyyy")} – ${format(dateRange.to, "dd MMM yyyy")}`
      : format(dateRange.from ?? today, "dd MMM yyyy");

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* ── Technical Toolbar ───────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card border border-border p-4 rounded-none shadow-none"
      >
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 pr-4 border-r border-border">
            <CalendarDays className="size-4 text-muted-foreground" />
            <div>
              <p className="text-[9px] font-bold uppercase  text-muted-foreground leading-none mb-1">
                Temporal Window
              </p>
              <p className="text-xs font-black uppercase  leading-none text-foreground">
                {displayRange}
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 text-[10px] font-bold uppercase  px-3 py-1.5 border rounded-none ${
              netProfitPositive
                ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-500"
                : "bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-500"
            }`}
          >
            {netProfitPositive ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {netProfitPositive ? "Profitable Cycle" : "Deficit Cycle"}
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[9px] font-bold uppercase  text-muted-foreground">
            <HardDrive className="size-3" />
            SYS_SYNC: {format(new Date(), "HH:mm:ss")}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <DatePickerWithRange
            date={dateRange}
            onDateChange={handleDateRangeChange}
            className="w-full sm:w-[280px]"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isFetching}
            className="h-9 w-9 rounded-none border-border shadow-none hover:bg-muted"
          >
            <RefreshCw
              className={`size-3.5 ${isFetching ? "animate-spin text-primary" : "text-muted-foreground"}`}
            />
          </Button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <DashboardKpiCards data={data} />
      </motion.div>

      {/* ── Advanced Analytics Row ──────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 lg:grid-cols-12 gap-4"
      >
        <RevenueExpenseChart
          data={data.revenueExpenseChart}
          dateRangeLabel={displayRange}
          previousPeriod={data.previousPeriod}
          className="lg:col-span-8"
        />
        <CapitalAllocationChart
          rawStock={data.rawStockValue}
          finishedStock={data.finishedStockValue}
          payroll={data.totalPayrollCost}
          expenses={data.totalExpenses}
          className="lg:col-span-4"
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <RecentActivityFeed data={data.recentActivity} />
      </motion.div>
    </motion.div>
  );
}
