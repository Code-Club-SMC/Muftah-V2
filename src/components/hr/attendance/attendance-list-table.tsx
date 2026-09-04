import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/custom/data-table";
import { Button } from "@/components/ui/button";
import { Edit2, ExternalLink, MapPin, MoonStar } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EditAttendanceSheet } from "./edit-attendance-sheet";
import {
  type PunchTimelineItem,
} from "./punch-timeline-preview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { parseISO } from "date-fns";
import { toPKTTime } from "@/lib/attendance/time";
import type { AttendanceEntrySource } from "@/lib/attendance/order-booker-day-state";

// ── Types ──────────────────────────────────────────────────────────────────

interface AttendanceRecord {
  id: string;
  checkIn: string | null;
  checkOut: string | null;
  status: "present" | "absent" | "leave" | "holiday";
  dutyHours: string | null;
  overtimeHours: string | null;
  isLate: boolean | null;
  isNightShift: boolean | null;
  isApprovedLeave: boolean | null;
  earlyDepartureStatus?: "none" | "pending" | "approved" | "rejected" | null;
  leaveType?: "sick" | "annual" | "special" | "compensatory" | null;
  overtimeStatus: "pending" | "approved" | "rejected" | null;
  overtimeRemarks: string | null;
  entrySource: AttendanceEntrySource | null;
  notes: string | null;
  areaVisited?: string | null;
  paymentMode?: "per_km" | null;
  distanceKm?: string | null;
  perKmRate?: string | null;
  saleAmount?: string | null;
  recoveryAmount?: string | null;
  returnAmount?: string | null;
  slipNumbers?: string | null;
  shopType?: "old" | "new" | null;
}

interface EmployeeWithAttendance {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  status?: string;
  isOrderBooker: boolean;
  standardDutyHours: number | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  shifts?: { start: string; end: string }[] | null;
  /**
   * Days of week this employee does NOT work.
   * 0=Sun … 6=Sat. Defaults to [0] (Sunday) if absent.
   */
  restDays?: number[];
  attendance: AttendanceRecord[];
  dailyPunches?: PunchTimelineItem[];
}

interface Props {
  data: EmployeeWithAttendance[];
  date: string; // ISO date string — the day being displayed
}

// ── Helpers ────────────────────────────────────────────────────────────────

const getInitials = (first: string, last: string) =>
  `${first?.charAt(0) || ""}${last?.charAt(0) || ""}`.toUpperCase();

/**
 * Returns true when `date` falls on one of the employee's rest days.
 * This is checked per-employee because different employees can have
 * different weekly rest days (e.g. office staff get Sat+Sun, factory
 * floor staff only get Sunday).
 */
function isRestDay(date: string, restDays: number[] = [0]): boolean {
  if (!restDays.length) return false;
  return restDays.includes(parseISO(date).getDay());
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

// ── Status Badge ───────────────────────────────────────────────────────────

const StatusBadge = ({
  status,
  leaveType,
}: {
  status: AttendanceRecord["status"] | undefined;
  leaveType?: AttendanceRecord["leaveType"] | null;
}) => {
  if (!status)
    return (
      <span className="text-muted-foreground text-[13px] font-medium">
        No Record
      </span>
    );

  const variants = {
    present:
      "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400",
    absent:
      "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400",
    leave:
      "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400",
    holiday:
      "bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400",
  };

  return (
    <Badge
      variant="secondary"
      className={cn(
        "capitalize font-medium text-[11px] px-2 py-0.5",
        variants[status],
      )}
    >
      {status.replace("_", " ")} {status === "leave" && leaveType ? `(${leaveType === "compensatory" ? "Comp Off" : leaveType})` : ""}
    </Badge>
  );
};

// ── Rest Day Cell ──────────────────────────────────────────────────────────

/**
 * Inline indicator rendered in the Status column for rest-day rows.
 * Kept as a component so it's reusable across both tab column sets.
 */
export const RestDayBadge = () => (
  <Badge
    variant="outline"
    className="bg-linear-to-br from-slate-100 via-slate-50 to-slate-100/50 dark:from-slate-800/40 dark:via-slate-900/20 dark:to-slate-800/30 text-slate-600 dark:text-slate-400 border-dashed border-slate-300/80 dark:border-slate-700/80 gap-1.5 px-2 py-0.5 text-[11px] font-medium pointer-events-none"
  >
    <MoonStar className="size-3 opacity-80" />
    <span>Rest Day</span>
  </Badge>
);

const PendingReviewBadge = () => (
  <Badge
    variant="outline"
    className="bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-800/70 px-2 py-0.5 text-[11px] font-medium"
  >
    Pending / Review
  </Badge>
);
// ── Employee Cell (shared) ─────────────────────────────────────────────────

const EmployeeCell = ({ row }: { row: EmployeeWithAttendance }) => (
  <div className="flex items-center gap-3 min-w-[200px]">
    <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
      <span className="text-xs font-semibold text-primary">
        {getInitials(row.firstName, row.lastName)}
      </span>
    </div>
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[13px] text-foreground leading-tight">
          {row.firstName} {row.lastName}
        </span>
        {row.status === "terminated" || row.status === "resigned" ? (
          <Badge
            variant="outline"
            className="text-[9px] px-1 h-4 bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900 leading-none"
          >
            {row.status === "terminated" ? "Terminated" : "Resigned"}
          </Badge>
        ) : null}
      </div>
      <span className="text-[12px] text-muted-foreground/80 leading-tight mt-0.5">
        {row.designation}
      </span>
    </div>
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────

export const AttendanceListTable = ({ data, date }: Props) => {
  const [selectedEmployee, setSelectedEmployee] =
    useState<EmployeeWithAttendance | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleEdit = (employee: EmployeeWithAttendance) => {
    setSelectedEmployee(employee);
    setIsDialogOpen(true);
  };

  // ── Standard Staff Columns ───────────────────────────────────────────────
  const standardColumns: ColumnDef<EmployeeWithAttendance>[] = [
    {
      header: "Employee",
      cell: ({ row }) => {
        return <EmployeeCell row={row.original} />;
      },
    },
    {
      header: "Status",
      cell: ({ row }) => {
        const record = row.original.attendance[0];
        if (isRestDay(date, row.original.restDays) && !record) {
          return <RestDayBadge />;
        }
        return (
          <div className="flex items-center gap-2">
            <StatusBadge status={record?.status} leaveType={record?.leaveType} />
            {isRestDay(date, row.original.restDays) && <RestDayBadge />}
          </div>
        );
      },
    },
    {
      header: "Shift Window",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays) && !row.original.attendance[0])
          return (
            <span className="text-muted-foreground/40 text-[13px]">—</span>
          );
        return (
          <span className="text-[13px] font-medium text-foreground">
            {formatScheduledShift(
              row.original.shifts,
            ) ?? "--:--"}
          </span>
        );
      },
    },
    {
      header: "First Punch In",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays) && !row.original.attendance[0])
          return (
            <span className="text-muted-foreground/40 text-[13px]">—</span>
          );
        const firstIn = row.original.dailyPunches?.find((p) => p.direction === "in");
        const fallback = row.original.attendance[0]?.checkIn;
        const value = firstIn
          ? toPKTTime(firstIn.timestamp).slice(0, 5)
          : fallback
            ? fallback.slice(0, 5)
            : null;
        return (
          <span className="text-[13px] font-medium tabular-nums text-foreground">
            {value ?? "—"}
          </span>
        );
      },
    },
    {
      header: "Last Punch Out",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays) && !row.original.attendance[0])
          return (
            <span className="text-muted-foreground/40 text-[13px]">—</span>
          );
        const lastOut = [...(row.original.dailyPunches ?? [])].reverse().find((p) => p.direction === "out");
        const fallback = row.original.attendance[0]?.checkOut;
        const value = lastOut
          ? toPKTTime(lastOut.timestamp).slice(0, 5)
          : fallback
            ? fallback.slice(0, 5)
            : null;
        return (
          <span className="text-[13px] font-medium tabular-nums text-foreground">
            {value ?? "—"}
          </span>
        );
      },
    },
    {
      header: "Worked Hours",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays) && !row.original.attendance[0])
          return (
            <span className="text-muted-foreground/40 text-[13px]">—</span>
          );
        return (
          <span className="text-[13px] font-medium">
            {row.original.attendance[0]?.dutyHours
              ? `${row.original.attendance[0].dutyHours}h`
              : "-"}
          </span>
        );
      },
    },
    {
      header: "OT Review",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays) && !row.original.attendance[0])
          return <span className="text-muted-foreground/40">—</span>;
        const record = row.original.attendance[0];
        const ot = record?.overtimeHours;
        const status = record?.overtimeStatus ?? "pending";
        if (!ot || parseFloat(ot) <= 0) {
          return <span className="text-muted-foreground">-</span>;
        }

        if (status === "approved") {
          return (
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-500">
                {ot}h
              </span>
              <span className="text-[10px] font-bold uppercase tracking-tight text-emerald-500">
                Approved
              </span>
            </div>
          );
        }

        if (status === "rejected") {
          return (
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-rose-600 line-through opacity-70 dark:text-rose-500">
                {ot}h
              </span>
              <span className="text-[10px] font-bold uppercase tracking-tight text-rose-500">
                Rejected
              </span>
            </div>
          );
        }

        return (
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-amber-600 dark:text-amber-500">
              {ot}h
            </span>
            <span className="text-[10px] font-bold uppercase tracking-tight text-amber-500">
              Pending
            </span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const inactive =
          row.original.status === "terminated" ||
          row.original.status === "resigned";
        const disabled = inactive;

        let title = "Edit Attendance";
        if (inactive) title = "Cannot edit attendance for inactive employees";

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-7 rounded-md transition-colors",
                disabled
                  ? "text-muted-foreground/30 cursor-not-allowed pointer-events-none"
                  : "text-blue-600 hover:text-primary hover:bg-primary/10",
              )}
              onClick={() => !disabled && handleEdit(row.original)}
              disabled={disabled}
              title={title}
            >
              <Edit2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              asChild
              title="View Details"
            >
              <Link
                to="/hr/attendance/$employeeId"
                params={{ employeeId: row.original.id }}
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];

  // ── Order Booker Columns ──────────────────────────────────────────────────
  const orderBookerColumns: ColumnDef<EmployeeWithAttendance>[] = [
    {
      header: "Employee",
      cell: ({ row }) => {
        return <EmployeeCell row={row.original} />;
      },
      footer: () => (
        <div className="text-[13px] font-semibold text-muted-foreground">
          TOTALS
        </div>
      ),
    },
    {
      header: "Status",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays)) return <RestDayBadge />;
        const record = row.original.attendance[0];
        if (!record) return <PendingReviewBadge />;
        return <StatusBadge status={record.status} leaveType={record.leaveType} />;
      },
    },
    {
      header: "Area",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays))
          return (
            <span className="text-muted-foreground/40 text-[13px]">—</span>
          );
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {row.original.attendance[0]?.areaVisited && (
              <MapPin className="size-3.5 opacity-70" />
            )}
            <span className="text-[13px] font-medium text-foreground truncate max-w-[120px]">
              {row.original.attendance[0]?.areaVisited || "-"}
            </span>
          </div>
        );
      },
    },
    {
      id: "distance",
      header: () => <div className="text-right">Distance</div>,
      accessorFn: (row) => row.attendance[0]?.distanceKm || "0",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays))
          return <div className="text-right text-muted-foreground/40">—</div>;
        return (
          <div className="text-right text-[13px] font-medium">
            {row.original.attendance[0]?.distanceKm
              ? `${row.original.attendance[0].distanceKm} km`
              : "-"}
          </div>
        );
      },
    },
    {
      id: "dynamicTa",
      header: () => <div className="text-right">Dyn. TA</div>,
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays))
          return <div className="text-right text-muted-foreground/40">—</div>;
        const record = row.original.attendance[0];
        if (!record || record.paymentMode !== "per_km")
          return <div className="text-right text-muted-foreground">-</div>;
        const ta =
          parseFloat(record.distanceKm || "0") *
          parseFloat(record.perKmRate || "0");
        return (
          <div className="text-right text-[13px] font-semibold text-foreground">
            {ta > 0 ? ta.toLocaleString() : "-"}
          </div>
        );
      },
      footer: ({ table }) => {
        const total = table.getFilteredRowModel().rows.reduce((sum, row) => {
          if (isRestDay(date, row.original.restDays)) return sum;
          const rec = row.original.attendance[0];
          if (rec?.paymentMode === "per_km") {
            return (
              sum +
              parseFloat(rec.distanceKm || "0") *
                parseFloat(rec.perKmRate || "0")
            );
          }
          return sum;
        }, 0);
        return (
          <div className="text-right text-[13px] font-semibold text-emerald-600 dark:text-emerald-500">
            {total > 0 ? total.toLocaleString() : "0"}
          </div>
        );
      },
    },
    {
      id: "sale",
      header: () => <div className="text-right">Sale</div>,
      accessorFn: (row) => row.attendance[0]?.saleAmount || "0",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays))
          return <div className="text-right text-muted-foreground/40">—</div>;
        const val = parseFloat(row.original.attendance[0]?.saleAmount || "0");
        return (
          <div className="text-right text-[13px] font-medium">
            {val > 0 ? val.toLocaleString() : "-"}
          </div>
        );
      },
      footer: ({ table }) => {
        const total = table.getFilteredRowModel().rows.reduce((sum, row) => {
          if (isRestDay(date, row.original.restDays)) return sum;
          return (
            sum + parseFloat(row.original.attendance[0]?.saleAmount || "0")
          );
        }, 0);
        return (
          <div className="text-right text-[13px] font-semibold">
            {total > 0 ? total.toLocaleString() : "0"}
          </div>
        );
      },
    },
    {
      id: "recovery",
      header: () => <div className="text-right">Recovery</div>,
      accessorFn: (row) => row.attendance[0]?.recoveryAmount || "0",
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays))
          return <div className="text-right text-muted-foreground/40">—</div>;
        const val = parseFloat(
          row.original.attendance[0]?.recoveryAmount || "0",
        );
        return (
          <div className="text-right text-[13px] font-semibold text-blue-600 dark:text-blue-400">
            {val > 0 ? val.toLocaleString() : "-"}
          </div>
        );
      },
      footer: ({ table }) => {
        const total = table.getFilteredRowModel().rows.reduce((sum, row) => {
          if (isRestDay(date, row.original.restDays)) return sum;
          return (
            sum + parseFloat(row.original.attendance[0]?.recoveryAmount || "0")
          );
        }, 0);
        return (
          <div className="text-right text-[13px] font-semibold text-blue-600 dark:text-blue-400">
            {total > 0 ? total.toLocaleString() : "0"}
          </div>
        );
      },
    },
    {
      id: "returnAmount",
      header: () => <div className="text-right">Return</div>,
      cell: ({ row }) => {
        if (isRestDay(date, row.original.restDays))
          return <div className="text-right text-muted-foreground/40">—</div>;
        const val = parseFloat(row.original.attendance[0]?.returnAmount || "0");
        return (
          <div className="text-right text-[13px] font-medium text-rose-600 dark:text-rose-500">
            {val > 0 ? val.toLocaleString() : "-"}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const rest = isRestDay(date, row.original.restDays);
        const inactive =
          row.original.status === "terminated" ||
          row.original.status === "resigned";
        const disabled = rest || inactive;

        let title = "Edit Log";
        if (inactive) title = "Cannot edit log for inactive employees";
        else if (rest) title = "Cannot edit attendance on a rest day";

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-7 rounded-md transition-colors",
                disabled
                  ? "text-muted-foreground/30 cursor-not-allowed pointer-events-none"
                  : "text-blue-600 hover:text-primary hover:bg-primary/10",
              )}
              onClick={() => !disabled && handleEdit(row.original)}
              disabled={disabled}
              title={title}
            >
              <Edit2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              asChild
              title="View Marketing Details"
            >
              <Link
                to="/hr/order-booker-details/$employeeId"
                params={{ employeeId: row.original.id }}
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];

  const standardData = data.filter((e) => !e.isOrderBooker);
  const orderBookerData = data.filter((e) => e.isOrderBooker);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Tabs defaultValue="standard" className="w-full">
        <div className="flex justify-between items-end mb-4">
          <TabsList className="bg-muted/50 p-1 h-10 rounded-lg">
            <TabsTrigger
              value="standard"
              className="gap-2 px-4 text-[13px] rounded-md data-[state=active]:bg-background data-[state=active]:"
            >
              <Users className="size-3.5" />
              Standard Staff
            </TabsTrigger>
            <TabsTrigger
              value="orderbooker"
              className="gap-2 px-4 text-[13px] rounded-md data-[state=active]:bg-background data-[state=active]:"
            >
              <Zap className="size-3.5" />
              Order Bookers
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="standard"
          className="mt-0 focus-visible:outline-none"
        >
          <DataTable
            columns={standardColumns}
            data={standardData}
            pageSize={100}
            showSearch={false}
            showPagination={false}
            showFooter={false}
          />
        </TabsContent>

        <TabsContent
          value="orderbooker"
          className="mt-0 focus-visible:outline-none"
        >
          <DataTable
            columns={orderBookerColumns}
            data={orderBookerData}
            pageSize={100}
            showSearch={false}
            showPagination={false}
            showFooter={true}
          />
        </TabsContent>
      </Tabs>

      {selectedEmployee && (
        <EditAttendanceSheet
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          employee={selectedEmployee}
          attendance={selectedEmployee.attendance[0]}
          date={date}
        />
      )}
    </div>
  );
};
