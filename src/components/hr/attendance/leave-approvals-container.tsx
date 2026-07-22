import { useState, useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getLeaveApprovalsFn } from "@/server-functions/hr/attendance/leave-approvals-fn";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { GenericEmpty } from "@/components/custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import { CalendarX, Check, X, FileClock, Clock } from "lucide-react";
import { useProcessLeaveApproval } from "@/hooks/hr/use-process-leave-approval";
import { format, parseISO } from "date-fns";
import { DataTable } from "@/components/custom/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, Variants } from "framer-motion";
import { SharpInteractiveKPICard } from "./SharpINteractiveKpiCard";

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

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "Annual Leave",
  sick: "Sick Leave",
  special: "Special Leave",
  casual: "Casual Leave",
  unpaid: "Unpaid Leave",
};

export function LeaveApprovalsContainer() {
  const [status, setStatus] = useState<FilterStatus>("pending");

  const { data } = useSuspenseQuery({
    queryKey: ["leave-approvals", status],
    queryFn: () => getLeaveApprovalsFn({ data: { status } }),
  });

  const { records, stats } = data;
  const mutation = useProcessLeaveApproval();

  const handleProcess = (
    id: string,
    newStatus: "approved" | "rejected" | "pending",
  ) => {
    mutation.mutate({ id, status: newStatus });
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
        accessorKey: "leaveType",
        header: "Leave Type",
        cell: ({ row }) => {
          const lt = row.original.leaveType;
          return (
            <Badge
              variant="outline"
              className="text-[9px] font-bold uppercase  rounded-none border-border"
            >
              {lt ? LEAVE_TYPE_LABELS[lt] || lt : "—"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "notes",
        header: "Notes / Reason",
        cell: ({ row }) => (
          <div className="max-w-[200px]">
            <span
              className="text-xs font-medium text-muted-foreground line-clamp-2"
              title={row.original.notes}
            >
              {row.original.notes || "—"}
            </span>
          </div>
        ),
      },
      {
        id: "statusBadge",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.leaveApprovalStatus;
          if (s === "approved")
            return (
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-bold uppercase  text-[9px] rounded-none px-2 py-0.5"
              >
                Approved
              </Badge>
            );
          if (s === "rejected")
            return (
              <Badge
                variant="outline"
                className="bg-rose-500/10 text-rose-600 border-rose-500/20 font-bold uppercase  text-[9px] rounded-none px-2 py-0.5"
              >
                Rejected
              </Badge>
            );
          return (
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold uppercase  text-[9px] rounded-none px-2 py-0.5 animate-pulse"
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
          const isPending = row.original.leaveApprovalStatus === "pending";
          return (
            <div className="flex items-center gap-2 justify-end pr-2">
              {isPending ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 rounded-none shadow-none border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 bg-emerald-500/5"
                    onClick={() => handleProcess(row.original.id, "approved")}
                    disabled={mutation.isPending}
                    title="Approve Leave (no deduction)"
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 rounded-none shadow-none border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-400 bg-rose-500/5"
                    onClick={() => handleProcess(row.original.id, "rejected")}
                    disabled={mutation.isPending}
                    title="Reject Leave (deduction applies)"
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[10px] uppercase  font-bold text-muted-foreground hover:text-primary rounded-none"
                  onClick={() => handleProcess(row.original.id, "pending")}
                  disabled={mutation.isPending}
                >
                  Reset
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [mutation.isPending], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Reusable sleek tab trigger classes
  const tabTriggerStyles =
    "relative h-12 rounded-none border-none bg-transparent px-0 pb-4 pt-4 text-[11px] font-bold uppercase  text-muted-foreground hover:text-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none focus-visible:ring-0 focus-visible:outline-none outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-transparent data-[state=active]:after:bg-foreground transition-colors";

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      {/* ── Sharp Interactive KPI Cards ───────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <SharpInteractiveKPICard
          title="Pending"
          value={stats.pendingCount.toString()}
          subtext="Awaiting review"
          icon={Clock}
          theme="amber"
          active={status === "pending"}
          onClick={() => setStatus("pending")}
        />
        <SharpInteractiveKPICard
          title="Approved"
          value={stats.approvedCount.toString()}
          subtext="Leave granted"
          icon={Check}
          theme="emerald"
          active={status === "approved"}
          onClick={() => setStatus("approved")}
        />
        <SharpInteractiveKPICard
          title="Rejected"
          value={stats.rejectedCount.toString()}
          subtext="Leave denied"
          icon={CalendarX}
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
                    {stats.pendingCount}
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
                    {stats.approvedCount}
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
                  <CalendarX className="size-3.5 group-data-[state=active]:text-rose-500 transition-colors" />
                  <span>Rejected</span>
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4.5 px-1.5 text-[10px] font-black rounded-none bg-rose-500/10 text-rose-600 border-rose-500/20 group-data-[state=active]:bg-rose-500 group-data-[state=active]:text-white transition-colors"
                  >
                    {stats.rejectedCount}
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
              <FileClock className="size-3.5 text-primary" />
              Leave <span className="text-foreground">Management Console</span>
            </div>
          </div>

          <TabsContent
            value={status}
            className="mt-0 outline-none border border-border bg-card rounded-none shadow-none"
          >
            {records.length === 0 ? (
              <div className="py-16 bg-muted/10">
                <GenericEmpty
                  icon={HREmptyIllustration}
                  title="All caught up!"
                  description={`No ${status !== "all" ? status : ""} leave requests found in this view.`}
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
