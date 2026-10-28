import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Clock,
  User,
  Briefcase,
  Hash,
  CalendarClock,
  TrendingUp,
  MoonStar,
  TriangleAlert,
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
import { EditAttendanceSheet } from "./edit-attendance-sheet";
import {
  dayIssueLabels,
  getDayIssues,
  isRestDate,
  standardHoursFor,
  type DayIssue,
  type DayIssueKind,
  type DayIssueSeverity,
} from "@/lib/attendance/day-issues";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { useProcessOvertime } from "@/hooks/hr/use-process-overtime";
import { useProcessLeaveApproval } from "@/hooks/hr/use-process-leave-approval";
import { hasPermission } from "@/lib/rbac";
import { useApplyCompensatoryCover } from "@/hooks/hr/use-compensatory-bank";
import { maxCoverHours } from "@/lib/attendance/compensatory-bank";
import { CompensatoryBankPanel } from "./compensatory-bank-panel";

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
  issues: DayIssue[];
  locked: boolean;
};

type IssueFilter = "all" | "open" | DayIssueKind;

// ── Helper ─────────────────────────────────────────────────────────────────

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

const severityRank: Record<DayIssueSeverity, number> = {
  action: 3,
  deduction: 2,
  info: 1,
};

const severityBadge: Record<DayIssueSeverity, string> = {
  action:
    "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  deduction:
    "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  info: "border-border bg-muted/40 text-muted-foreground",
};

const severityRow: Record<DayIssueSeverity, string> = {
  action: "border-l-4 border-l-amber-500 bg-amber-500/10 hover:bg-amber-500/15",
  deduction: "border-l-4 border-l-rose-500 bg-rose-500/5 hover:bg-rose-500/10",
  info: "",
};

function worstSeverity(issues: DayIssue[]): DayIssueSeverity | null {
  return issues.reduce<DayIssueSeverity | null>(
    (worst, issue) =>
      !worst || severityRank[issue.severity] > severityRank[worst]
        ? issue.severity
        : worst,
    null,
  );
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

  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [editDate, setEditDate] = useState<string | null>(null);
  const { data: viewer } = useViewerAccess();
  const canManage = hasPermission(viewer?.permissions ?? [], "hr.manage");
  const overtime = useProcessOvertime();
  const leave = useProcessLeaveApproval();
  const cover = useApplyCompensatoryCover();

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
      getEmployeeAttendanceLogFn({
        data: { employeeId: employeeId!, startDate, endDate },
      }),
    gcTime: 0,
  });

  if (!employeeId) return null;

  const { employee, records, punchesByDate, lockedPayrolls, today: todayPKT } =
    data;

  // Rest days configured for this employee — default to Sunday if not set
  const restDays: number[] = (employee as any).restDays ?? [0];
  const standardHours = standardHoursFor(employee);

  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate),
  });

  // ── Stats — include worked duty and overtime from rest days, but exempt undertime ──────
  const activeRecords = records.filter(
    (r: any) => !isRestDate(r.date, restDays) || r.status === "present",
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
        if (isRestDate(r.date, restDays)) return acc; // Never penalize rest days
        const duty = parseFloat(r.dutyHours || "0");
        if (r.status === "present" && duty < standardHours) {
          return acc + (standardHours - duty);
        }
        return acc;
      }, 0)
      .toFixed(2),
    daysPresent: records.filter((r: any) => r.status === "present").length,
  };

  // ── Table rows ─────────────────────────────────────────────────────────
  const tableRows: DayRow[] = days.map((day, idx) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const record = records.find((r: any) => r.date === dateStr);
    const punches = punchesByDate[dateStr] ?? [];
    const locked = lockedPayrolls.some(
      (p) => p.startDate <= dateStr && p.endDate >= dateStr,
    );
    return {
      idx,
      dateStr,
      day,
      isRestDay: isRestDate(dateStr, restDays),
      record,
      punches,
      standardDutyHours: standardHours,
      locked,
      issues: getDayIssues({
        date: dateStr,
        today: todayPKT,
        employee,
        record,
        punches,
        lockedPayroll: locked,
      }),
    };
  });

  const issueCounts = new Map<DayIssueKind, { count: number; severity: DayIssueSeverity }>();
  for (const row of tableRows)
    for (const issue of row.issues) {
      if (issue.grace) continue;
      const current = issueCounts.get(issue.kind);
      issueCounts.set(issue.kind, {
        count: (current?.count ?? 0) + 1,
        severity: issue.severity,
      });
    }
  const openDays = tableRows.filter((row) =>
    row.issues.some((issue) => issue.severity === "action"),
  ).length;
  const visibleRows = tableRows.filter((row) =>
    issueFilter === "all"
      ? true
      : issueFilter === "open"
        ? row.issues.some((issue) => issue.severity === "action")
        : row.issues.some(
            (issue) => issue.kind === issueFilter && !issue.grace,
          ),
  );
  const editRow = tableRows.find((row) => row.dateStr === editDate);
  const busy = overtime.isPending || leave.isPending || cover.isPending;
  const bankBalance = Number(employee.compensatoryHoursBalance ?? 0);

  // ── Columns ────────────────────────────────────────────────────────────
  const columns: ColumnDef<DayRow>[] = [
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
            {row.original.dateStr > todayPKT ? "Upcoming" : "Unmarked"}
          </Badge>
        );
      },
    },
    {
      id: "issues",
      header: "Issues",
      cell: ({ row }) =>
        row.original.issues.length ? (
          <div className="flex max-w-72 flex-wrap gap-1">
            {row.original.issues.map((issue) => (
              <Badge
                key={issue.kind}
                variant="outline"
                className={cn(
                  "text-[10px] font-semibold px-1.5 py-0",
                  severityBadge[issue.severity],
                )}
              >
                {issue.label}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        ),
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

  if (canManage)
    columns.push({
      id: "actions",
      header: "Action",
      cell: ({ row }) => {
        const { record, issues, locked, dateStr } = row.original;
        if (locked || dateStr < employee.joiningDate || dateStr > todayPKT)
          return null;
        const has = (kind: DayIssueKind) =>
          issues.some((issue) => issue.kind === kind);
        return (
          <div className="flex flex-wrap gap-1">
            {record && has("overtime_pending") && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    overtime.mutate({ id: record.id, status: "approved" })
                  }
                >
                  Approve OT
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    overtime.mutate({ id: record.id, status: "rejected" })
                  }
                >
                  Reject OT
                </Button>
              </>
            )}
            {record && has("undertime") && !row.original.isRestDay && (() => {
              const currentCover = Number(record.compensatoryHoursUsed || "0");
              const coverable = maxCoverHours({
                standardHours: row.original.standardDutyHours,
                dutyHours: Number(record.dutyHours || "0"),
                balance: bankBalance,
                currentCover,
              });
              return coverable > currentCover ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    cover.mutate({ attendanceId: record.id, hours: coverable })
                  }
                >
                  Use {formatDuration(coverable)} from bank
                </Button>
              ) : null;
            })()}
            {record && has("bank_cover") && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => cover.mutate({ attendanceId: record.id, hours: 0 })}
              >
                Remove bank cover
              </Button>
            )}
            {record && has("leave_pending") && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    leave.mutate({ id: record.id, status: "approved" })
                  }
                >
                  Approve leave
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    leave.mutate({ id: record.id, status: "rejected" })
                  }
                >
                  Reject leave
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant={
                issues.some((issue) => issue.severity === "action")
                  ? "default"
                  : "outline"
              }
              disabled={busy}
              aria-label={`Edit attendance on ${dateStr}`}
              onClick={() => setEditDate(dateStr)}
            >
              {record ? "Fix" : "Mark"}
            </Button>
          </div>
        );
      },
    });

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

      {/* ── Balances ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border bg-muted/20 px-4 py-3 text-sm">
        <span>
          <span className="text-muted-foreground">Annual leave left: </span>
          <span className="font-semibold tabular-nums">
            {employee.annualLeaveBalance ?? 0} /{" "}
            {employee.annualLeaveAllowance ?? 14}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Sick leave left: </span>
          <span className="font-semibold tabular-nums">
            {employee.sickLeaveBalance ?? 0}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Comp-off bank: </span>
          <span className="font-semibold tabular-nums">
            {Number(employee.compensatoryHoursBalance ?? 0)}h
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Expected per day: </span>
          <span className="font-semibold tabular-nums">
            {formatDuration(standardHours)}
          </span>
        </span>
      </div>

      <CompensatoryBankPanel
        employeeId={employee.id}
        balance={bankBalance}
        canManage={canManage}
      />

      {/* ── Issue summary ────────────────────────────────────────────────── */}
      <section
        aria-label="Attendance issues"
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-4",
          openDays > 0 && "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {openDays > 0 && (
              <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />
            )}
            {openDays > 0
              ? `${openDays} days need HR action`
              : "No days need HR action"}
          </h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={issueFilter === "open" ? "default" : "outline"}
              disabled={openDays === 0}
              onClick={() =>
                setIssueFilter(issueFilter === "open" ? "all" : "open")
              }
            >
              Only days needing action
            </Button>
            {issueFilter !== "all" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIssueFilter("all")}
              >
                Show all days
              </Button>
            )}
          </div>
        </div>
        {issueCounts.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...issueCounts.entries()]
              .sort(
                ([, a], [, b]) =>
                  severityRank[b.severity] - severityRank[a.severity],
              )
              .map(([kind, { count, severity }]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={issueFilter === kind}
                  onClick={() =>
                    setIssueFilter(issueFilter === kind ? "all" : kind)
                  }
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-semibold transition-colors",
                    severityBadge[severity],
                    issueFilter === kind && "ring-2 ring-primary",
                  )}
                >
                  {dayIssueLabels[kind]} · {count}
                </button>
              ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Amber = HR must decide. Red = reduces pay. Grey = for information.
        </p>
      </section>

      {/* ── Attendance DataTable ─────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={visibleRows}
        showSearch={false}
        showViewOptions={false}
        pageSize={31}
        getRowClassName={(row) => {
          const worst = worstSeverity(row.issues);
          return worst ? severityRow[worst] : undefined;
        }}
      />

      {editRow && (
        <EditAttendanceSheet
          open
          onOpenChange={(next) => {
            if (!next) setEditDate(null);
          }}
          employee={employee}
          attendance={editRow.record ?? null}
          date={editRow.dateStr}
        />
      )}
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
