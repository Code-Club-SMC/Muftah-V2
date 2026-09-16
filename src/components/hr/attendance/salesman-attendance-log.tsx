import { useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  CheckCircle2,
  CircleHelp,
  Coins,
  Hash,
  MoonStar,
  PackageCheck,
  Phone,
  Receipt,
  ShoppingBag,
  Truck,
  User,
  Wallet,
} from "lucide-react";
import { DataTable } from "@/components/custom/data-table";
import { Badge } from "@/components/ui/badge";
import { formatPKR } from "@/lib/currency-format";
import { cn } from "@/lib/utils";
import {
  getSalesmanActivityLogFn,
  type SalesmanActivityDay,
  type SalesmanActivityStatus,
} from "@/server-functions/hr/attendance/get-salesman-activity-log-fn";

type Props = {
  employeeId?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
  showHeader?: boolean;
};

type StatColor = "emerald" | "amber" | "rose" | "blue" | "indigo" | "slate";

const statusConfig: Record<
  SalesmanActivityStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  present: {
    label: "Present",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  pending_review: {
    label: "Pending / Review",
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",
    icon: CircleHelp,
  },
  rest_day: {
    label: "Rest Day",
    className: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400",
    icon: MoonStar,
  },
  absent: {
    label: "Absent",
    className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
    icon: CircleHelp,
  },
  leave: {
    label: "Leave",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300",
    icon: CircleHelp,
  },
  holiday: {
    label: "Holiday",
    className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300",
    icon: MoonStar,
  },
};

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
  indigo: {
    bg: "bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-200/60",
    iconBg: "bg-indigo-100 dark:bg-indigo-900/40",
    icon: "text-indigo-600",
    value: "text-indigo-700 dark:text-indigo-400",
    text: "text-indigo-600/70",
  },
  slate: {
    bg: "bg-slate-50/60 dark:bg-slate-950/20 border-slate-200/60",
    iconBg: "bg-slate-100 dark:bg-slate-900/40",
    icon: "text-slate-600",
    value: "text-slate-700 dark:text-slate-400",
    text: "text-slate-600/70",
  },
};

function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString("en-PK", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function StatusBadge({ status }: { status: SalesmanActivityStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 px-2 py-0 text-[10px] font-black uppercase tracking-wide",
        config.className,
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}

function MoneyCell({ value }: { value: number }) {
  if (value <= 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <span className="text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
      {formatPKR(value)}
    </span>
  );
}

function StatCard({
  color,
  icon: Icon,
  label,
  value,
  prefix,
  suffix,
}: {
  color: StatColor;
  icon: typeof User;
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
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
          "mb-3 flex h-9 w-9 items-center justify-center rounded-xl",
          c.iconBg,
        )}
      >
        <Icon size={18} className={c.icon} />
      </div>
      <p className={cn("mb-1 text-[10px] font-bold uppercase", c.text)}>
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-black leading-tight tracking-tight",
          c.value,
        )}
      >
        {prefix && (
          <span className="mr-1 text-sm font-bold opacity-60">{prefix}</span>
        )}
        {value}
        {suffix && (
          <span className="ml-1 text-sm font-bold opacity-60">{suffix}</span>
        )}
      </p>
    </div>
  );
}

export const SalesmanAttendanceLog = ({
  employeeId: propId,
  month,
  startDate: propStartDate,
  endDate: propEndDate,
  showHeader = true,
}: Props) => {
  const params = useParams({ strict: false });
  const routeEmployeeId = (params as { employeeId?: string }).employeeId;
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
    queryKey: ["salesman-activity-log", employeeId, startDate, endDate],
    queryFn: () =>
      getSalesmanActivityLogFn({
        data: { employeeId, startDate, endDate },
      }),
    gcTime: 0,
  });

  const { employee, summary, days } = data;

  const columns: ColumnDef<SalesmanActivityDay>[] = [
    {
      id: "date",
      header: "Date",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold">
            {format(parseISO(row.original.date), "dd MMM yyyy")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {row.original.weekday}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1 items-start">
          <StatusBadge status={row.original.status} />
          {row.original.attendanceEntrySource === "salesman_activity" && (
            <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Field Active
            </span>
          )}
        </div>
      ),
    },
    {
      id: "deliveries",
      header: "Deliveries",
      cell: ({ row }) => {
        const day = row.original;
        if (day.deliveryCount === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-black tabular-nums">
              {day.deliveryCount} {day.deliveryCount === 1 ? "order" : "orders"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatPKR(day.totalDeliveredAmount)}
            </span>
          </div>
        );
      },
    },
    {
      id: "recoveries",
      header: "Credit Recoveries",
      cell: ({ row }) => {
        const day = row.original;
        if (day.recoveryCount === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-black tabular-nums">
              {day.recoveryCount} {day.recoveryCount === 1 ? "recovery" : "recoveries"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatPKR(day.totalRecoveredAmount)}
            </span>
          </div>
        );
      },
    },
    {
      id: "deliveredAmount",
      header: "Delivered Value",
      cell: ({ row }) => <MoneyCell value={row.original.totalDeliveredAmount} />,
    },
    {
      id: "recoveredAmount",
      header: "Recovered / Promised",
      cell: ({ row }) => <MoneyCell value={row.original.totalRecoveredAmount} />,
    },
    {
      id: "details",
      header: "Activity Details / Notes",
      cell: ({ row }) => {
        const day = row.original;
        const hasDeliveries = day.deliveries.length > 0;
        const hasRecoveries = day.recoveries.length > 0;
        const hasNotes = day.notes.length > 0;

        if (!hasDeliveries && !hasRecoveries && !hasNotes) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-wrap gap-1.5 max-w-[320px]">
            {hasDeliveries && (
              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300">
                <PackageCheck className="mr-1 size-2.5" />
                {day.deliveries.length} delivered
              </Badge>
            )}
            {hasRecoveries && (
              <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300">
                <Receipt className="mr-1 size-2.5" />
                {day.recoveries.length} recoveries
              </Badge>
            )}
            {hasNotes && (
              <span className="text-[11px] text-muted-foreground italic truncate">
                {day.notes.join("; ")}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-12">
        {showHeader && (
          <div className="group relative overflow-hidden rounded-2xl border bg-card transition-all hover:shadow-md md:col-span-6 lg:col-span-4">
            <div className="absolute right-0 top-0 p-8 opacity-[0.03] scale-150 rotate-12 transition-transform group-hover:scale-[1.7] group-hover:rotate-0">
              <User size={120} />
            </div>
            <div className="relative flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:items-start sm:text-left">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
                <User size={40} />
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <h2 className="truncate text-2xl font-extrabold tracking-tight text-foreground">
                    {employee.name}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start">
                    <span className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      <Briefcase size={14} className="text-primary" />
                      {employee.designation}
                    </span>
                    <span className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      <Hash size={12} />
                      {employee.employeeCode}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
                  <Badge
                    variant="outline"
                    className="bg-blue-500/10 text-blue-700 border-blue-400/20 text-[10px] font-bold uppercase tracking-wider"
                  >
                    <Briefcase className="mr-1 size-2.5" />
                    Salesman
                  </Badge>
                  {employee.phone && (
                    <Badge
                      variant="outline"
                      className="bg-muted text-muted-foreground text-[10px] font-mono"
                    >
                      <Phone className="mr-1 size-2.5" />
                      {employee.phone}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      employee.status === "active"
                        ? "bg-emerald-500/10 text-emerald-700 border-emerald-400/20"
                        : "bg-rose-500/10 text-rose-700 border-rose-400/20",
                    )}
                  >
                    {employee.status}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className={cn(
            "grid grid-cols-2 gap-4 lg:grid-cols-6",
            showHeader ? "md:col-span-6 lg:col-span-8" : "md:col-span-12",
          )}
        >
          <StatCard
            color="emerald"
            icon={CheckCircle2}
            label="Present"
            value={String(summary.presentDays)}
            suffix="days"
          />
          <StatCard
            color={summary.pendingDays > 0 ? "amber" : "slate"}
            icon={CircleHelp}
            label="Pending"
            value={String(summary.pendingDays)}
            suffix="days"
          />
          <StatCard
            color="blue"
            icon={Truck}
            label="Deliveries"
            value={String(summary.totalDeliveries)}
          />
          <StatCard
            color="indigo"
            icon={Receipt}
            label="Recoveries"
            value={String(summary.totalRecoveries)}
          />
          <StatCard
            color="emerald"
            icon={ShoppingBag}
            label="Delivered"
            value={formatNumber(summary.totalDeliveredAmount)}
            prefix="PKR"
          />
          <StatCard
            color="amber"
            icon={Wallet}
            label="Recovered"
            value={formatNumber(summary.totalRecoveredAmount)}
            prefix="PKR"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Truck className="size-3 text-blue-500" />
            Deliveries Completed
          </div>
          <p className="text-sm font-semibold">
            {summary.totalDeliveries} orders · {formatPKR(summary.totalDeliveredAmount)}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Receipt className="size-3 text-indigo-500" />
            Credit Recoveries
          </div>
          <p className="text-sm font-semibold">
            {summary.totalRecoveries} visits · {formatPKR(summary.totalRecoveredAmount)}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Coins className="size-3 text-emerald-500" />
            Total Value Managed
          </div>
          <p className="text-sm font-semibold">
            {formatPKR(summary.totalDeliveredAmount + summary.totalRecoveredAmount)}
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={days}
        showSearch={false}
        showViewOptions={false}
        pageSize={10}
      />
    </div>
  );
};
