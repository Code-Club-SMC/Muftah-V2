import { useState, useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getOvertimeApprovalsFn } from "@/server-functions/hr/attendance/get-overtime-approvals-fn";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { GenericEmpty } from "@/components/custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import {
  Clock,
  Check,
  X,
  AlertCircle,
  FileClock,
  ShieldCheck,
} from "lucide-react";
import { useProcessOvertime } from "@/hooks/hr/use-process-overtime";
import { format, parseISO } from "date-fns";
import { DataTable } from "@/components/custom/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, Variants } from "framer-motion";

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

type FilterStatus = "pending" | "approved" | "rejected" | "all";

export function OvertimeApprovalsContainer() {
  const [status, setStatus] = useState<FilterStatus>("pending");

  const { data } = useSuspenseQuery({
    queryKey: ["overtime-approvals", status],
    queryFn: () => getOvertimeApprovalsFn({ data: { status } }),
  });

  const { records, stats } = data;
  const mutateOT = useProcessOvertime();

  const handleProcess = (
    id: string,
    newStatus: "approved" | "rejected" | "pending",
  ) => {
    mutateOT.mutate({ id, status: newStatus });
  };

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      {
        accessorKey: "employeeCode",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-[11px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-none border border-border">
            {row.original.employeeCode}
          </span>
        ),
      },
      {
        id: "employee",
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        header: "Employee",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-bold text-[13px] leading-tight text-foreground">
              {row.original.firstName} {row.original.lastName}
            </span>
            <span className="text-[9px] font-bold text-muted-foreground uppercase  mt-0.5">
              {row.original.designation}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "date",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-[13px] font-bold tabular-nums uppercase  text-foreground">
            {format(parseISO(row.original.date), "dd MMM yyyy")}
          </span>
        ),
      },
      {
        id: "hours",
        header: "Hours",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground font-bold uppercase  tabular-nums">
              Duty: {row.original.dutyHours}h
            </span>
            <span
              className={cn(
                "text-[13px] font-black tabular-nums tracking-tight",
                row.original.overtimeStatus === "approved"
                  ? "text-emerald-600 dark:text-emerald-500"
                  : row.original.overtimeStatus === "rejected"
                    ? "text-rose-600 dark:text-rose-500 line-through opacity-70"
                    : "text-amber-600 dark:text-amber-500",
              )}
            >
              OT: +{row.original.overtimeHours}h
            </span>
          </div>
        ),
      },
      {
        id: "standardHours",
        header: "Standard",
        cell: ({ row }) => (
          <span className="text-[13px] font-bold tabular-nums text-muted-foreground uppercase">
            {row.original.standardDutyHours}h
          </span>
        ),
      },
      {
        id: "suggestedOvertime",
        header: "Suggested OT",
        cell: ({ row }) => (
          <span className="text-[13px] font-bold tabular-nums text-[#0B3A70] dark:text-blue-400">
            +{row.original.suggestedOvertimeHours.toFixed(2)}h
          </span>
        ),
      },
      {
        accessorKey: "overtimeRemarks",
        header: "Operator Remarks",
        cell: ({ row }) => (
          <div className="max-w-[220px]">
            <span
              className="text-xs font-medium text-muted-foreground line-clamp-2"
              title={row.original.overtimeRemarks}
            >
              {row.original.overtimeRemarks || "No reason provided"}
            </span>
          </div>
        ),
      },
      {
        id: "statusBadge",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.overtimeStatus;
          if (row.original.isOvertimeRequestStale) {
            return (
              <Badge
                variant="outline"
                className="bg-red-500/10 text-red-600 border-red-500/20 font-bold uppercase text-[9px] rounded-none px-2 py-0.5 animate-pulse"
                title={row.original.overtimeRequestWarning || "Requested OT exceeds suggested OT"}
              >
                Needs Recheck
              </Badge>
            );
          }
          if (s === "approved") {
            return (
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold uppercase text-[9px] rounded-none px-2 py-0.5"
              >
                Approved
              </Badge>
            );
          }
          if (s === "rejected") {
            return (
              <Badge
                variant="outline"
                className="bg-rose-500/10 text-rose-600 border-rose-500/20 font-bold uppercase text-[9px] rounded-none px-2 py-0.5"
              >
                Rejected
              </Badge>
            );
          }
          return (
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold uppercase text-[9px] rounded-none px-2 py-0.5 animate-pulse"
            >
              Pending
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const isPending = row.original.overtimeStatus === "pending";
          const isStale = row.original.isOvertimeRequestStale;

          return (
            <div className="flex items-center gap-2 justify-end pr-2">
              {isPending ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 rounded-none shadow-none border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 bg-emerald-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => handleProcess(row.original.id, "approved")}
                    disabled={mutateOT.isPending || isStale}
                    title={isStale ? "Cannot approve stale OT request" : "Approve OT"}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 rounded-none shadow-none border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-400 bg-rose-500/5"
                    onClick={() => handleProcess(row.original.id, "rejected")}
                    disabled={mutateOT.isPending}
                    title="Reject OT"
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[10px] uppercase font-bold text-muted-foreground hover:text-primary rounded-none"
                  onClick={() => handleProcess(row.original.id, "pending")}
                  disabled={mutateOT.isPending}
                >
                  Reset
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [mutateOT.isPending],
  );

  // Reusable sleek tab trigger classes
  const tabTriggerStyles =
    "relative h-12 rounded-none border-none bg-transparent px-2 pb-4 pt-4 text-[11px] font-bold uppercase  text-muted-foreground hover:text-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none focus-visible:ring-0 focus-visible:outline-none outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-transparent data-[state=active]:after:bg-foreground transition-colors";

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <SharpInteractiveKPICard
          title="Pending Requests"
          value={stats.pendingRequests.toString()}
          subtext={`${stats.pendingHours.toFixed(1)} hrs pending`}
          icon={Clock}
          theme="amber"
          active={status === "pending"}
          onClick={() => setStatus("pending")}
        />
        <SharpInteractiveKPICard
          title="Approved (Cycle)"
          value={stats.approvedRequests.toString()}
          subtext={`${stats.approvedHours.toFixed(1)} hrs approved`}
          icon={ShieldCheck}
          theme="emerald"
          active={status === "approved"}
          onClick={() => setStatus("approved")}
        />
        <SharpInteractiveKPICard
          title="Rejected (Cycle)"
          value={stats.rejectedRequests.toString()}
          subtext={`${stats.rejectedHours.toFixed(1)} hrs rejected`}
          icon={AlertCircle}
          theme="rose"
          active={status === "rejected"}
          onClick={() => setStatus("rejected")}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Tabs
          value={status}
          onValueChange={(v) => setStatus(v as FilterStatus)}
          className="w-full"
        >
          {/* The Tabs Header */}
          <div className="flex flex-col sm:flex-row items-end sm:items-center justify-between gap-4 border-b border-border/50 pb-px">
            <TabsList className="h-auto p-0 bg-transparent gap-2 sm:gap-6">
              <TabsTrigger
                value="pending"
                className={cn(
                  tabTriggerStyles,
                  "group data-[state=active]:after:bg-amber-500",
                )}
              >
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5 group-data-[state=active]:text-amber-500 transition-colors" />
                  <span>Pending</span>
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4.5 px-1.5 text-[10px] font-black rounded-none bg-amber-500/10 text-amber-600 border-amber-500/20 group-data-[state=active]:bg-amber-500 group-data-[state=active]:text-white transition-colors"
                  >
                    {stats.pendingRequests}
                  </Badge>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="approved"
                className={cn(
                  tabTriggerStyles,
                  "group data-[state=active]:after:bg-emerald-500",
                )}
              >
                <div className="flex items-center gap-2">
                  <Check className="size-3.5 group-data-[state=active]:text-emerald-500 transition-colors" />
                  <span>Approved</span>
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4.5 px-1.5 text-[10px] font-black rounded-none bg-emerald-500/10 text-emerald-600 border-emerald-500/20 group-data-[state=active]:bg-emerald-500 group-data-[state=active]:text-white transition-colors"
                  >
                    {stats.approvedRequests}
                  </Badge>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="rejected"
                className={cn(
                  tabTriggerStyles,
                  "group data-[state=active]:after:bg-rose-500",
                )}
              >
                <div className="flex items-center gap-2">
                  <X className="size-3.5 group-data-[state=active]:text-rose-500 transition-colors" />
                  <span>Rejected</span>
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4.5 px-1.5 text-[10px] font-black rounded-none bg-rose-500/10 text-rose-600 border-rose-500/20 group-data-[state=active]:bg-rose-500 group-data-[state=active]:text-white transition-colors"
                  >
                    {stats.rejectedRequests}
                  </Badge>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="all"
                className={cn(
                  tabTriggerStyles,
                  "group data-[state=active]:after:bg-foreground",
                )}
              >
                <div className="flex items-center gap-2">
                  <FileClock className="size-3.5 transition-colors" />
                  <span>All History</span>
                </div>
              </TabsTrigger>
            </TabsList>

            <div className="hidden sm:flex text-[10px] text-muted-foreground font-bold uppercase  items-center gap-2 pb-4">
              <ShieldCheck className="size-3.5 text-primary" />
              Overtime{" "}
              <span className="text-foreground">Management Console</span>
            </div>
          </div>

          <TabsContent
            value={status}
            className="mt-4 outline-none border border-border bg-card rounded-none shadow-none"
          >
            {records.length === 0 ? (
              <div className="py-16 bg-muted/10">
                <GenericEmpty
                  icon={HREmptyIllustration}
                  title="All caught up!"
                  description={`No ${status !== "all" ? status : ""} overtime requests found in this view.`}
                />
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={records}
                searchKey="employee"
                searchPlaceholder="Search by employee name..."
                pageSize={10}
                className="border-none shadow-none rounded-none"
              />
            )}
          </TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
  blue: {
    border: "border-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
    activeBg: "bg-blue-500/5",
  },
  rose: {
    border: "border-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
    activeBg: "bg-rose-500/5",
  },
  emerald: {
    border: "border-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
    activeBg: "bg-emerald-500/5",
  },
  violet: {
    border: "border-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
    activeBg: "bg-violet-500/5",
  },
  amber: {
    border: "border-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
    activeBg: "bg-amber-500/5",
  },
};

function SharpInteractiveKPICard({
  title,
  value,
  subtext,
  icon: Icon,
  theme,
  active,
  onClick,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: any;
  theme: KPITheme;
  active: boolean;
  onClick: () => void;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      onClick={onClick}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border rounded-none shadow-none cursor-pointer transition-colors border-t-2",
        active
          ? cn("border-x border-b", styles.border, styles.activeBg)
          : cn("border-border hover:bg-muted/30", styles.border),
      )}
    >
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
        <div className="flex items-center gap-2">
          {active && (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] uppercase font-black rounded-none border-border",
                styles.iconText,
              )}
            >
              Active View
            </Badge>
          )}
          <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
            <Icon className={cn("size-4", styles.iconText)} />
          </div>
        </div>
      </div>
      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-black tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <p className="text-[10px] font-bold uppercase  text-muted-foreground/70">
          {subtext}
        </p>
      </div>
    </motion.div>
  );
}
