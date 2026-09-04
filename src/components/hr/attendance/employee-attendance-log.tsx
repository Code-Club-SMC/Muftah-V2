import { useSuspenseQuery } from "@tanstack/react-query";
import { getEmployeeAttendanceLogFn } from "@/server-functions/hr/attendance/get-employee-attendance-log-fn";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  User,
  Briefcase,
  Hash,
  CalendarClock,
  TrendingUp,
  MoonStar,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { useParams } from "@tanstack/react-router";
import { DataTable } from "@/components/custom/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  PunchTimelinePreview,
  type PunchTimelineItem,
} from "./punch-timeline-preview";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  employeeId?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
  showHeader?: boolean;
};

type DayRow = {
  idx: number;
  dateStr: string;
  day: Date;
  /** True when this calendar day is a configured rest day for this employee */
  isRestDay: boolean;
  record: any | undefined;
  punches: PunchTimelineItem[];
  standardDutyHours: number;
};

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the given ISO date string falls on one of the
 * employee's configured rest days (0=Sun … 6=Sat).
 */
function checkIsRestDay(dateStr: string, restDays: number[]): boolean {
  if (!restDays.length) return false;
  return restDays.includes(parseISO(dateStr).getDay());
}

function formatTimeLabel(value?: string | null): string | null {
  if (!value) return null;
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function formatScheduledShift(
  shifts?: { start: string; end: string }[] | null,
): string | null {
  if (!shifts || shifts.length === 0) return null;
  return shifts
    .map((s) => {
      const start = formatTimeLabel(s.start);
      const end = formatTimeLabel(s.end);
      return `${start ?? "--:--"}-${end ?? "--:--"}`;
    })
    .join(" / ");
}

// ── Component ──────────────────────────────────────────────────────────────

export const EmployeeAttendanceLog = ({
  employeeId: propId,
  month,
  startDate: propStartDate,
  endDate: propEndDate,
  showHeader = true,
}: Props) => {
  const params = useParams({ strict: false });
  // @ts-ignore
  const routeEmployeeId = params.employeeId;
  const employeeId = propId || routeEmployeeId;

  if (!employeeId) return null;

  const today = new Date();
  const currentMonth = month || format(today, "yyyy-MM");
  const startDate =
    propStartDate ||
    format(startOfMonth(parseISO(`${currentMonth}-01`)), "yyyy-MM-dd");
  const endDate =
    propEndDate ||
    format(endOfMonth(parseISO(`${currentMonth}-01`)), "yyyy-MM-dd");

  const { data } = useSuspenseQuery({
    queryKey: ["employee-attendance-log", employeeId, startDate, endDate],
    queryFn: () =>
      getEmployeeAttendanceLogFn({ data: { employeeId, startDate, endDate } }),
    gcTime: 0,
  });

  const { employee, records, punchesByDate } = data;

  // Rest days configured for this employee — default to Sunday if not set
  const restDays: number[] = (employee as any).restDays ?? [0];

  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate),
  });

  // ── Stats — include worked duty and overtime from rest days, but exempt undertime ──────
  const activeRecords = records.filter(
    (r: any) => !checkIsRestDay(r.date, restDays) || r.status === "present",
  );

  const stats = {
    totalDuty: activeRecords
      .reduce(
        (acc: number, r: any) => acc + (parseFloat(r.dutyHours || "0") || 0),
        0,
      )
      .toFixed(1),
    totalOvertime: records
      .reduce((acc: number, r: any) => {
        if (r.overtimeStatus === "approved") {
          return acc + (parseFloat(r.overtimeHours || "0") || 0);
        }
        return acc;
      }, 0)
      .toFixed(1),
    totalUndertime: records
      .reduce((acc: number, r: any) => {
        if (checkIsRestDay(r.date, restDays)) return acc; // Never penalize rest days
        const duty = parseFloat(r.dutyHours || "0");
        const standard = employee.standardDutyHours || 8;
        if (r.status === "present" && duty < standard) {
          return acc + (standard - duty);
        }
        return acc;
      }, 0)
      .toFixed(1),
    daysPresent: records.filter((r: any) => r.status === "present").length,
  };

  // ── Table rows ─────────────────────────────────────────────────────────
  const tableRows: DayRow[] = days.map((day, idx) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return {
      idx,
      dateStr,
      day,
      isRestDay: checkIsRestDay(dateStr, restDays),
      record: records.find((r: any) => r.date === dateStr),
      punches: punchesByDate[dateStr] ?? [],
      standardDutyHours: employee.standardDutyHours || 8,
    };
  });

  // ── Columns ────────────────────────────────────────────────────────────
  const columns: ColumnDef<DayRow>[] = [
    {
      id: "no",
      header: "#",
      cell: ({ row }) => (
        <span
          className={cn(
            "text-muted-foreground font-mono text-xs tabular-nums",
            row.original.isRestDay && "opacity-40",
          )}
        >
          {row.original.idx + 1}
        </span>
      ),
    },
    {
      id: "date",
      header: "Date",
      cell: ({ row }) => {
        const { day, isRestDay } = row.original;
        return (
          <div className="flex flex-col">
            <span
              className={cn(
                "font-semibold text-xs",
                isRestDay && "text-muted-foreground/60",
              )}
            >
              {format(day, "dd MMM yyyy")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {format(day, "EEEE")}
            </span>
          </div>
        );
      },
    },
    {
      id: "scheduledShift",
      header: "Shift Window",
      cell: ({ row }) => {
        if (row.original.isRestDay)
          return <span className="text-muted-foreground/40 text-xs">—</span>;
        return (
          <span className="text-xs font-medium text-foreground">
            {formatScheduledShift(
              (employee as any).shifts,
            ) ?? "—"}
          </span>
        );
      },
    },
    {
      id: "punchSpan",
      header: "Punch Timeline",
      cell: ({ row }) => {
        if (row.original.isRestDay && !row.original.record && row.original.punches.length === 0)
          return <span className="text-muted-foreground/40 text-xs">—</span>;
        return (
          <PunchTimelinePreview
            punches={row.original.punches}
            fallbackCheckIn={row.original.record?.checkIn}
            fallbackCheckOut={row.original.record?.checkOut}
            className="min-w-[220px]"
          />
        );
      },
    },
    {
      id: "duty",
      header: "Worked (h)",
      cell: ({ row }) => {
        if (row.original.isRestDay && !row.original.record)
          return <span className="text-muted-foreground/40 text-xs">—</span>;
        const record = row.original.record;
        const duty = parseFloat(record?.dutyHours || "0");
        const standard = row.original.standardDutyHours;
        const isUnder = !row.original.isRestDay && duty < standard && record?.status === "present";
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-xs tabular-nums">
              {record?.dutyHours || "0.00"}
            </span>
            {isUnder && (
              <span className="text-[10px] text-rose-500 font-bold tabular-nums">
                −{formatDuration(standard - duty)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "overtime",
      header: "OT Review",
      cell: ({ row }) => {
        if (row.original.isRestDay && !row.original.record)
          return <span className="text-muted-foreground/40 text-xs">—</span>;
        const record = row.original.record;
        if (!record)
          return <span className="text-muted-foreground text-xs">—</span>;
        const ot = parseFloat(record.overtimeHours || "0");
        if (ot <= 0)
          return <span className="text-muted-foreground text-xs">—</span>;

        if (record.overtimeStatus === "approved") {
          return (
            <div className="flex flex-col">
              <span className="text-emerald-600 font-bold text-xs tabular-nums">
                +{record.overtimeHours}
              </span>
              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter">
                Approved
              </span>
            </div>
          );
        }
        if (record.overtimeStatus === "pending") {
          return (
            <div className="flex flex-col">
              <span className="text-amber-500 font-bold text-xs tabular-nums">
                +{record.overtimeHours}
              </span>
              <span className="text-[9px] font-black text-amber-500 uppercase tracking-tighter">
                Pending Admin
              </span>
            </div>
          );
        }
        return (
          <div className="flex flex-col">
            <span className="text-rose-600 font-bold text-xs tabular-nums line-through opacity-70">
              +{record.overtimeHours}
            </span>
            <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">
              Rejected
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const { record, isRestDay } = row.original;

        // ── Rest day with no record ──────
        if (isRestDay && !record) {
          return (
            <div className="flex items-center gap-1.5">
              <MoonStar className="size-3 text-slate-400" />
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
                Rest Day
              </span>
            </div>
          );
        }

        if (record) {
          const statusColors: Record<string, string> = {
            present:
              "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400",
            absent:
              "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400",
            leave:
              "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400",
            holiday:
              "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400",
            restDay:
              "bg-slate-50  border-slate-200 dark:bg-slate-950/30 dark:text-slate-400",
          };
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-bold uppercase px-2 py-0",
                  statusColors[record.status] || "",
                )}
              >
                {record.status.replace("_", " ")} {record.status === "leave" && record.leaveType ? `(${record.leaveType === "compensatory" ? "Comp Off" : record.leaveType})` : ""}
              </Badge>
              {isRestDay && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-bold uppercase px-1.5 py-0 bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-900 dark:text-slate-400"
                >
                  Rest Day
                </Badge>
              )}
            </div>
          );
        }

        return (
          <Badge
            variant="outline"
            className="text-[10px] border-slate-300 text-slate-500 font-bold uppercase px-2 py-0"
          >
            Pending
          </Badge>
        );
      },
    },
    {
      id: "notes",
      header: "Notes",
      cell: ({ row }) => {
        if (row.original.isRestDay && !row.original.record) return null;
        return (
          <span className="text-xs italic text-muted-foreground">
            {row.original.record?.notes || ""}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header / Stats ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
        {showHeader && (
          <div className="md:col-span-6 lg:col-span-5 relative group overflow-hidden rounded-2xl border bg-card transition-all hover:shadow-md">
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] scale-150 rotate-12 transition-transform group-hover:scale-[1.7] group-hover:rotate-0">
              <User size={120} />
            </div>
            <div className="relative p-6 flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="shrink-0 h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20">
                <User size={40} />
              </div>
              <div className="flex-1 text-center sm:text-left space-y-2">
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-foreground truncate">
                    {employee.firstName} {employee.lastName}
                  </h2>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2 mt-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      <Briefcase size={14} className="text-primary" />{" "}
                      {employee.designation}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-mono bg-muted/50 px-2 py-0.5 rounded-md text-muted-foreground border">
                      <Hash size={12} /> {employee.employeeCode}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center sm:justify-start gap-2 pt-1">
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 text-[10px] font-bold tracking-wider uppercase"
                  >
                    {employee.employmentType?.replace("_", " ") || "FULL TIME"}
                  </Badge>
                  {/* Rest days badge */}
                  {restDays.length > 0 && (
                    <Badge
                      variant="outline"
                      className="bg-slate-500/10 text-slate-600 border-slate-400/20 text-[10px] font-bold tracking-wider uppercase dark:text-slate-400"
                    >
                      <MoonStar className="size-2.5 mr-1" />
                      Off:{" "}
                      {restDays
                        .map(
                          (d) =>
                            ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                              d
                            ],
                        )
                        .join(", ")}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className={cn(
            "grid grid-cols-2 lg:grid-cols-4 gap-4",
            showHeader ? "md:col-span-6 lg:col-span-7" : "md:col-span-12",
          )}
        >
          <StatCard
            color="emerald"
            icon={Clock}
            label="Total Duty"
            value={stats.totalDuty}
            unit="hrs"
          />
          <StatCard
            color="amber"
            icon={CalendarClock}
            label="Overtime"
            value={stats.totalOvertime}
            unit="hrs"
          />
          <StatCard
            color="rose"
            icon={Clock}
            label="Undertime"
            value={stats.totalUndertime}
            unit="hrs"
          />
          <StatCard
            color="blue"
            icon={TrendingUp}
            label="Days Present"
            value={String(stats.daysPresent)}
            unit="days"
          />
        </div>
      </div>

      {/* ── Attendance DataTable ─────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={tableRows}
        showSearch={false}
        showViewOptions={false}
        pageSize={31}
      />
    </div>
  );
};

// ── Stat Card ──────────────────────────────────────────────────────────────

type StatColor = "emerald" | "amber" | "rose" | "blue";

const statColorMap: Record<
  StatColor,
  { bg: string; iconBg: string; icon: string; value: string; text: string }
> = {
  emerald: {
    bg: "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/60",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
    icon: "text-emerald-600",
    value: "text-emerald-700 dark:text-emerald-400",
    text: "text-emerald-600/70",
  },
  amber: {
    bg: "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/60",
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    icon: "text-amber-600",
    value: "text-amber-700 dark:text-amber-400",
    text: "text-amber-600/70",
  },
  rose: {
    bg: "bg-rose-50/60 dark:bg-rose-950/20 border-rose-200/60",
    iconBg: "bg-rose-100 dark:bg-rose-900/40",
    icon: "text-rose-600",
    value: "text-rose-700 dark:text-rose-400",
    text: "text-rose-600/70",
  },
  blue: {
    bg: "bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/60",
    iconBg: "bg-blue-100 dark:bg-blue-900/40",
    icon: "text-blue-600",
    value: "text-blue-700 dark:text-blue-400",
    text: "text-blue-600/70",
  },
};

function StatCard({
  color,
  icon: Icon,
  label,
  value,
  unit,
}: {
  color: StatColor;
  icon: any;
  label: string;
  value: string;
  unit: string;
}) {
  const c = statColorMap[color];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 transition-all hover:shadow-md",
        c.bg,
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center mb-3",
          c.iconBg,
        )}
      >
        <Icon size={18} className={c.icon} />
      </div>
      <p
        className={cn(
          "text-[10px] font-bold uppercase  mb-1",
          c.text,
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-black tracking-tight leading-tight",
          c.value,
        )}
      >
        {value}
        <span className="text-sm font-bold ml-1 opacity-60">{unit}</span>
      </p>
    </div>
  );
}
