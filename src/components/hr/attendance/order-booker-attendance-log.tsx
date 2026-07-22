import { useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  CheckCircle2,
  CircleHelp,
  Fuel,
  Hash,
  MapPin,
  MoonStar,
  PackageCheck,
  Receipt,
  Route,
  ShoppingBag,
  Store,
  User,
} from "lucide-react";
import { DataTable } from "@/components/custom/data-table";
import { Badge } from "@/components/ui/badge";
import { formatPKR } from "@/lib/currency-format";
import { cn } from "@/lib/utils";
import {
  getOrderBookerActivityLogFn,
  type OrderBookerActivityDay,
  type OrderBookerActivityStatus,
} from "@/server-functions/hr/attendance/get-order-booker-activity-log-fn";

type Props = {
  employeeId?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
  showHeader?: boolean;
};

type StatColor = "emerald" | "amber" | "rose" | "blue" | "indigo" | "slate";

const statusConfig: Record<
  OrderBookerActivityStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  present: {
    label: "Present",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
  pending_review: {
    label: "Pending / Review",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    icon: CircleHelp,
  },
  rest_day: {
    label: "Rest Day",
    className: "bg-slate-50 text-slate-600 border-slate-200",
    icon: MoonStar,
  },
  absent: {
    label: "Absent",
    className: "bg-rose-50 text-rose-700 border-rose-200",
    icon: CircleHelp,
  },
  leave: {
    label: "Leave",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
    icon: CircleHelp,
  },
  holiday: {
    label: "Holiday",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    icon: MoonStar,
  },
};

const statColorMap: Record<StatColor, any> = {
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

function StatusBadge({ status }: { status: OrderBookerActivityStatus }) {
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
    <span className="text-xs font-bold tabular-nums text-emerald-700">
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

export const OrderBookerAttendanceLog = ({
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
    queryKey: ["order-booker-activity-log", employeeId, startDate, endDate],
    queryFn: () =>
      getOrderBookerActivityLogFn({
        data: { employeeId, startDate, endDate },
      }),
    gcTime: 0,
  });

  const { employee, orderBooker, rows, totals } = data;
  const restDays: number[] = employee.restDays ?? [0];

  const columns: ColumnDef<OrderBookerActivityDay>[] = [
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
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "trips",
      header: "Trips",
      cell: ({ row }) => {
        const day = row.original;
        if (day.tripCount === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-black tabular-nums">
              {day.tripCount} trip{day.tripCount === 1 ? "" : "s"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {day.emptyTripCount} empty · {day.orderTripCount} with order
            </span>
          </div>
        );
      },
    },
    {
      id: "shops",
      header: "Shops",
      cell: ({ row }) => {
        const day = row.original;
        if (day.tripCount === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              Old {day.oldShopVisits}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              New {day.newShopVisits}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "area",
      header: "Area",
      cell: ({ row }) => {
        const destinations = row.original.destinations;
        if (destinations.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="max-w-[220px] truncate text-xs font-semibold">
            {destinations.join(", ")}
          </div>
        );
      },
    },
    {
      id: "distance",
      header: "Distance / TA",
      cell: ({ row }) => {
        const day = row.original;
        if (day.totalDistanceKm <= 0 && day.totalTadaAmount <= 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-col">
            <span className="text-xs font-bold tabular-nums">
              {formatNumber(day.totalDistanceKm, 1)} km
            </span>
            <span className="text-[10px] text-muted-foreground">
              TA/DA {formatPKR(day.totalTadaAmount)}
            </span>
          </div>
        );
      },
    },
    {
      id: "fuel",
      header: "Fuel",
      cell: ({ row }) => <MoneyCell value={row.original.totalFuelCost} />,
    },
    {
      id: "orders",
      header: "Orders",
      cell: ({ row }) => {
        const day = row.original;
        if (day.orderCount === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-col">
            <span className="text-xs font-black tabular-nums">
              {day.orderCount} order{day.orderCount === 1 ? "" : "s"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatPKR(day.totalOrderValue)}
            </span>
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
                    {employee.firstName} {employee.lastName}
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
                    className="bg-emerald-500/10 text-emerald-700 border-emerald-400/20 text-[10px] font-bold uppercase tracking-wider"
                  >
                    <Store className="mr-1 size-2.5" />
                    {orderBooker.name}
                  </Badge>
                  {orderBooker.assignedArea && (
                    <Badge
                      variant="outline"
                      className="bg-blue-500/10 text-blue-700 border-blue-400/20 text-[10px] font-bold uppercase tracking-wider"
                    >
                      <MapPin className="mr-1 size-2.5" />
                      {orderBooker.assignedArea}
                    </Badge>
                  )}
                  {restDays.length > 0 && (
                    <Badge
                      variant="outline"
                      className="bg-slate-500/10 text-slate-600 border-slate-400/20 text-[10px] font-bold uppercase tracking-wider dark:text-slate-400"
                    >
                      <MoonStar className="mr-1 size-2.5" />
                      Off:{" "}
                      {restDays
                        .map(
                          (day) =>
                            ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                              day
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
            "grid grid-cols-2 gap-4 lg:grid-cols-6",
            showHeader ? "md:col-span-6 lg:col-span-8" : "md:col-span-12",
          )}
        >
          <StatCard
            color="emerald"
            icon={CheckCircle2}
            label="Present"
            value={String(totals.daysPresent)}
            suffix="days"
          />
          <StatCard
            color={totals.pendingReviewDays > 0 ? "amber" : "slate"}
            icon={CircleHelp}
            label="Pending"
            value={String(totals.pendingReviewDays)}
            suffix="days"
          />
          <StatCard
            color="blue"
            icon={Route}
            label="Trips"
            value={String(totals.tripCount)}
          />
          <StatCard
            color="indigo"
            icon={ShoppingBag}
            label="Orders"
            value={String(totals.orderCount)}
          />
          <StatCard
            color="amber"
            icon={PackageCheck}
            label="TA/DA"
            value={formatNumber(totals.totalTadaAmount)}
            prefix="PKR"
          />
          <StatCard
            color="emerald"
            icon={Receipt}
            label="Order Value"
            value={formatNumber(totals.totalOrderValue)}
            prefix="PKR"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Store className="size-3" />
            Shop Mix
          </div>
          <p className="text-sm font-semibold">
            Old {totals.oldShopVisits} · New {totals.newShopVisits}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <MapPin className="size-3" />
            Distance
          </div>
          <p className="text-sm font-semibold">
            {formatNumber(totals.totalDistanceKm, 1)} km
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Fuel className="size-3" />
            Fuel
          </div>
          <p className="text-sm font-semibold">
            {formatPKR(totals.totalFuelCost)}
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        showSearch={false}
        showViewOptions={false}
        pageSize={10}
      />
    </div>
  );
};
