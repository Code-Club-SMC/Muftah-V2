import { useSuspenseQuery } from "@tanstack/react-query";
import { listSalaryAdvancesFn } from "@/server-functions/hr/advances/advances-fn";
import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApproveAdvanceDialog } from "./approve-advance-dialog";
import { RequestAdvanceDialog } from "./request-advance-dialog";
import { useRejectSalaryAdvance } from "@/hooks/hr/use-salary-advances";
import {
  CheckCircle2,
  Clock,
  XCircle,
  Receipt,
  TrendingUp,
  Edit,
  Plus,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GenericEmpty } from "@/components/custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/custom/data-table";
import { motion, Variants } from "framer-motion";
import { SharpKPICard } from "../attendance/SharpINteractiveKpiCard";

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

// ── Status config ─────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className:
      "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  },
  approved: {
    label: "Approved",
    className:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  },
  deducted: {
    label: "Deducted",
    className:
      "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
  },
  rejected: {
    label: "Rejected",
    className:
      "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
  },
};

export function AdvancesContainer() {
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveAmount, setApproveAmount] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [advanceToEdit, setAdvanceToEdit] = useState<any>(null);

  const rejectMutate = useRejectSalaryAdvance();

  const { data: advances } = useSuspenseQuery({
    queryKey: ["salary-advances"],
    queryFn: () => listSalaryAdvancesFn({ data: { limit: 200 } }),
  });

  // KPI stats
  const pendingCount = advances.filter((a) => a.status === "pending").length;
  const pendingSum = advances
    .filter((a) => a.status === "pending")
    .reduce((s, a) => s + parseFloat(a.amount), 0);
  const approvedSum = advances
    .filter((a) => a.status === "approved" || a.status === "deducted")
    .reduce((s, a) => s + parseFloat(a.amount), 0);
  const totalSum = advances.reduce((s, a) => s + parseFloat(a.amount), 0);

  const filteredAdvances = useMemo(() => {
    if (!searchQuery.trim()) return advances;
    const q = searchQuery.toLowerCase();
    return advances.filter((a) => {
      const emp = a.employee;
      return (
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q) ||
        emp.employeeCode.toLowerCase().includes(q) ||
        a.reason?.toLowerCase().includes(q)
      );
    });
  }, [advances, searchQuery]);

  const columns: ColumnDef<(typeof advances)[number]>[] = useMemo(
    () => [
      {
        id: "employee",
        header: "Employee",
        cell: ({ row }) => {
          const emp = row.original.employee;
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8 rounded-none border border-border shadow-none">
                <AvatarFallback className="rounded-none text-[10px] font-bold bg-primary/10 text-primary">
                  {emp.firstName[0]}
                  {emp.lastName[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-bold text-[13px] leading-tight text-foreground">
                  {emp.firstName} {emp.lastName}
                </span>
                <span className="text-[9px] font-bold text-muted-foreground uppercase  mt-0.5">
                  {emp.employeeCode}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: "date",
        header: "Request Date",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-bold text-[13px] uppercase  tabular-nums text-foreground">
              {format(parseISO(row.original.date), "dd MMM yyyy")}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground line-clamp-1 max-w-[160px] mt-0.5">
              {row.original.reason}
            </span>
          </div>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-black text-[13px] tabular-nums text-foreground">
              PKR {parseFloat(row.original.amount).toLocaleString()}
            </span>
            <span className="text-[9px] font-semibold text-muted-foreground uppercase mt-0.5">
              {row.original.installmentMonths} Installments
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status as string;
          const cfg = statusConfig[s] ?? {
            label: s,
            className: "bg-muted text-muted-foreground",
          };
          return (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] font-bold uppercase  px-2 py-0.5 rounded-none",
                cfg.className,
              )}
            >
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          if (row.original.status !== "pending") return null;
          return (
            <div className="flex items-center gap-2 justify-end pr-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-none shadow-none border-primary/20 text-primary hover:bg-primary/5"
                onClick={() => {
                  setAdvanceToEdit(row.original);
                  setIsRequestDialogOpen(true);
                }}
              >
                <Edit className="size-3.5" />
                <span className="text-[10px] font-bold uppercase ">
                  Edit
                </span>
              </Button>

              <Button
                size="sm"
                className="h-8 gap-1.5 rounded-none shadow-none bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => {
                  setApproveAmount(row.original.amount);
                  setApproveId(row.original.id);
                }}
              >
                <CheckCircle2 className="size-3.5" />
                <span className="text-[10px] font-bold uppercase ">
                  Approve
                </span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5 px-3 rounded-none shadow-none"
                disabled={rejectMutate.isPending}
                onClick={() =>
                  rejectMutate.mutate({ data: { advanceId: row.original.id } })
                }
              >
                <XCircle className="size-3.5" />
                <span className="text-[10px] font-bold uppercase ">
                  Reject
                </span>
              </Button>
            </div>
          );
        },
      },
    ],
    [rejectMutate],
  );

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      {/* ── Header Area ────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <h1 className="text-xl font-black uppercase tracking-tighter text-foreground flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            Salary Advances
          </h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase ">
            Manage and approve employee advance requests
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            setAdvanceToEdit(null);
            setIsRequestDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          Request New Advance
        </Button>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <SharpKPICard
          title="Total Requests"
          value={advances.length.toString()}
          subtext="Advances in history"
          icon={Receipt}
          theme="blue"
        />
        <SharpKPICard
          title="Pending Approval"
          value={`PKR ${Math.round(pendingSum).toLocaleString()}`}
          subtext={`${pendingCount} request${pendingCount !== 1 ? "s" : ""} waiting`}
          icon={Clock}
          theme="amber"
        />
        <SharpKPICard
          title="Total Paid Out"
          value={`PKR ${Math.round(approvedSum).toLocaleString()}`}
          subtext="Approved & Deducted"
          icon={CheckCircle2}
          theme="emerald"
        />
        <SharpKPICard
          title="Grand Total"
          value={`PKR ${Math.round(totalSum).toLocaleString()}`}
          subtext="All time advance value"
          icon={TrendingUp}
          theme="violet"
        />
      </motion.div>

      {/* ── DataTable ─────────────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="border border-border bg-card rounded-none shadow-none"
      >
        <DataTable
          columns={columns}
          data={filteredAdvances}
          showSearch
          searchPlaceholder="Search employee or code..."
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          showViewOptions={false}
          pageSize={10}
          className="rounded-none border-none shadow-none"
          emptyState={
            <GenericEmpty
              icon={HREmptyIllustration}
              title="No results found"
              description="No salary advances matching your search."
            />
          }
        />
      </motion.div>

      <ApproveAdvanceDialog
        open={!!approveId}
        onOpenChange={(open) => !open && setApproveId(null)}
        advanceId={approveId}
        amount={approveAmount}
      />

      <RequestAdvanceDialog
        open={isRequestDialogOpen}
        onOpenChange={setIsRequestDialogOpen}
        advanceToEdit={advanceToEdit}
      />
    </motion.div>
  );
}
