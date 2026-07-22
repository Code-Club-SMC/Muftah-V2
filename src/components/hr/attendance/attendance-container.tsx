import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getDailyAttendanceFn } from "@/server-functions/hr/attendance/get-daily-attendance-fn";
import { AttendanceListTable } from "./attendance-list-table";
import { format, addDays, startOfToday, parseISO, isToday } from "date-fns";
import { motion, Variants } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  RotateCcw,
  Clock4,
  TimerOff,
  CalendarRange,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { BulkAttendanceSheet } from "./bulk-attendance-sheet";
import type { AttendanceEntrySource } from "@/lib/attendance/order-booker-day-state";

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

export const AttendanceContainer = () => {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    format(startOfToday(), "yyyy-MM-dd"),
  );

  const { data: employees } = useSuspenseQuery({
    queryKey: ["daily-attendance", selectedDate],
    queryFn: () => getDailyAttendanceFn({ data: { date: selectedDate } }),
    select: (data) =>
      data.map((e) => ({
        ...e,
        attendance: e.attendance.map((a) => ({
          ...a,
          earlyDepartureStatus: a.earlyDepartureStatus as
            | "none"
            | "pending"
            | "approved"
            | "rejected"
            | null,
          overtimeStatus: a.overtimeStatus as
            | "pending"
            | "approved"
            | "rejected"
            | null,
          entrySource: a.entrySource as AttendanceEntrySource | null,
        })),
      })),
  });

  const stats = {
    total: employees.length,
    present: employees.filter((e) => e.attendance[0]?.status === "present")
      .length,
    absent: employees.filter((e) => e.attendance[0]?.status === "absent")
      .length,
    late: employees.filter((e) => e.attendance[0]?.isLate).length,
    leave: employees.filter((e) => e.attendance[0]?.status === "leave").length,
    undertimeCount: employees.filter((e) => {
      const a = e.attendance[0];
      if (!a || a.status !== "present") return false;
      const duty = parseFloat(a.dutyHours || "0");
      const standard = (e as any).standardDutyHours || 8;
      return duty < standard;
    }).length,
    undertimeMins: employees.reduce((acc, e) => {
      const a = e.attendance[0];
      if (!a || a.status !== "present") return acc;
      const duty = parseFloat(a.dutyHours || "0");
      const standard = (e as any).standardDutyHours || 8;
      return duty < standard ? acc + Math.round((standard - duty) * 60) : acc;
    }, 0),
  };

  const handleDateChange = (days: number) => {
    const nextDate = addDays(parseISO(selectedDate), days);
    setSelectedDate(format(nextDate, "yyyy-MM-dd"));
  };

  const parsedDate = parseISO(selectedDate);
  const isTodaySelected = isToday(parsedDate);

  const attendanceRate =
    stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

  const formatUndertimeMins = (mins: number): string | null => {
    if (mins <= 0) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const undertimeLabel = formatUndertimeMins(stats.undertimeMins);

  const rateColorClass =
    attendanceRate >= 80
      ? "text-emerald-600 dark:text-emerald-500"
      : attendanceRate >= 60
        ? "text-amber-600 dark:text-amber-500"
        : "text-rose-600 dark:text-rose-500";

  const rateBarColorClass =
    attendanceRate >= 80
      ? "bg-emerald-500"
      : attendanceRate >= 60
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      {/* ── Sharp Header & Toolbar ──────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="relative border border-border bg-card rounded-none shadow-none overflow-hidden"
      >
        {/* Technical Grid Pattern */}
        <div
          className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
            backgroundSize: "8px 8px",
          }}
        />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 border-b border-border">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-primary/10 border border-primary/20 rounded-none">
              <Clock4 className="size-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold tracking-tight text-foreground uppercase">
                  Daily Ledger
                </h2>
                {isTodaySelected && (
                  <Badge
                    variant="outline"
                    className="text-[9px] font-bold uppercase  rounded-none border-border px-1.5 py-0"
                  >
                    Live
                  </Badge>
                )}
              </div>
              <p className="text-xs font-bold text-muted-foreground uppercase  mt-0.5">
                {format(parsedDate, "dd MMM yyyy")}
              </p>
            </div>
          </div>

          {/* Date Navigator & Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center border border-border bg-background">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-none border-r border-border hover:bg-muted"
                onClick={() => handleDateChange(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-9 px-4 rounded-none text-xs font-bold uppercase  gap-2 hover:bg-muted"
                  >
                    <CalendarDays className="size-3.5 text-muted-foreground" />
                    {format(parsedDate, "dd MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0 rounded-none border-border shadow-none"
                  align="center"
                >
                  <Calendar
                    mode="single"
                    selected={parsedDate}
                    onSelect={(date) =>
                      date && setSelectedDate(format(date, "yyyy-MM-dd"))
                    }
                  />
                </PopoverContent>
              </Popover>

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-none border-l border-border hover:bg-muted"
                onClick={() => handleDateChange(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="outline"
              size="icon"
              className={cn(
                "h-9 w-9 rounded-none border-border shadow-none hover:bg-muted",
                isTodaySelected && "opacity-50 pointer-events-none",
              )}
              onClick={() =>
                setSelectedDate(format(startOfToday(), "yyyy-MM-dd"))
              }
              title="Jump to Today"
            >
              <RotateCcw className="size-3.5" />
            </Button>

            <div className="w-px h-9 bg-border hidden sm:block mx-1" />
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <CalendarRange className="size-3.5 mr-2" />
              Bulk Mark
            </Button>
          </div>
        </div>

        {/* Sharp Attendance Rate Bar */}
        <div className="relative z-10 p-5 bg-muted/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase  text-muted-foreground">
              Fleet Attendance Rate
            </span>
            <div className="flex items-center gap-4">
              {undertimeLabel && stats.undertimeCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase  text-rose-600 dark:text-rose-500 border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5">
                  <TimerOff className="size-3" />−{undertimeLabel} (
                  {stats.undertimeCount} emp)
                </span>
              )}
              <span
                className={cn(
                  "text-lg font-black tabular-nums tracking-tight",
                  rateColorClass,
                )}
              >
                {attendanceRate}%
              </span>
            </div>
          </div>
          <div className="h-1.5 w-full bg-border rounded-none overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${attendanceRate}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className={cn("h-full rounded-none", rateBarColorClass)}
            />
          </div>
        </div>
      </motion.div>

      {/* ── Sharp KPI Summary Grid ────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <SharpKPICard
          title="Total Workforce"
          value={stats.total.toString()}
          subtext="Registered employees"
          icon={Users}
          theme="blue"
        />
        <SharpKPICard
          title="Present"
          value={stats.present.toString()}
          subtext="Checked in today"
          icon={CheckCircle2}
          theme="emerald"
        />
        <SharpKPICard
          title="Absent & Leave"
          value={(stats.absent + stats.leave).toString()}
          subtext={`${stats.leave} on approved leave`}
          icon={XCircle}
          theme="rose"
        />
        <SharpKPICard
          title="Late Arrivals"
          value={stats.late.toString()}
          subtext="Missed standard time"
          icon={Clock}
          theme="amber"
        />
      </motion.div>

      {/* ── Table Container ───────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="border border-border bg-card rounded-none shadow-none"
      >
        <AttendanceListTable data={employees} date={selectedDate} />
      </motion.div>

      {/* ── Modals/Sheets ─────────────────────────────────────────────── */}
      <BulkAttendanceSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        employees={employees}
      />
    </motion.div>
  );
};

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
  blue: {
    border: "border-t-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
  },
  rose: {
    border: "border-t-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
  },
  emerald: {
    border: "border-t-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
  },
  violet: {
    border: "border-t-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
  },
  amber: {
    border: "border-t-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
  },
};

function SharpKPICard({
  title,
  value,
  subtext,
  icon: Icon,
  theme,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: any;
  theme: KPITheme;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border,
      )}
    >
      {/* Technical Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: "8px 8px",
        }}
      />

      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-[10px] font-bold  text-muted-foreground uppercase">
          {title}
        </p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>

      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <p className="text-[10px] font-bold uppercase  text-muted-foreground/70">
          {subtext}
        </p>
      </div>
    </motion.div>
  );
}
