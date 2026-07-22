import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getEmployeeDeletionRequestsFn } from "@/server-functions/hr/employees/delete-employee-fn";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { GenericEmpty } from "@/components/custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import {
    UserX,
    ShieldAlert,
    Trash2,
    Undo2,
    AlertTriangle,
    Users
} from "lucide-react";
import {
    useApproveEmployeeDeletion,
    useCancelEmployeeDeletion
} from "@/hooks/hr/use-delete-employee";
import { DataTable } from "@/components/custom/data-table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, Variants } from "framer-motion";
import { useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";

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

export function EmployeeDeletionApprovalsContainer() {
    const { data } = useSuspenseQuery({
        queryKey: ["employee-deletion-requests"],
        queryFn: () => getEmployeeDeletionRequestsFn(),
    });

    const { records, stats } = data;
    const approveMutate = useApproveEmployeeDeletion();
    const cancelMutate = useCancelEmployeeDeletion();

    const [approvalId, setApprovalId] = useState<string | null>(null);
    const selectedEmployee = records.find(r => r.id === approvalId);

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
                            {row.original.designation} • {row.original.department}
                        </span>
                    </div>
                ),
            },
            {
                accessorKey: "joiningDate",
                header: "Joined",
                cell: ({ row }) => (
                    <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-tighter">
                        {row.original.joiningDate}
                    </span>
                ),
            },
            {
                accessorKey: "status",
                header: "Status",
                cell: () => (
                    <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/20 font-bold uppercase  text-[9px] rounded-none px-2 py-0.5 animate-pulse">
                        Pending Removal
                    </Badge>
                )
            },
            {
                id: "actions",
                header: () => <div className="text-right pr-4">Actions</div>,
                cell: ({ row }) => (
                    <div className="flex items-center gap-2 justify-end pr-2">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 rounded-none shadow-none border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 bg-emerald-500/5"
                            onClick={() => cancelMutate.mutate({ data: { id: row.original.id } })}
                            disabled={cancelMutate.isPending || approveMutate.isPending}
                            title="Cancel Request"
                        >
                            <Undo2 className="size-4 mr-1.5" />
                            <span className="text-[10px] font-bold uppercase">Restore</span>
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 rounded-none shadow-none border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-400 bg-rose-500/5"
                            onClick={() => setApprovalId(row.original.id)}
                            disabled={cancelMutate.isPending || approveMutate.isPending}
                            title="Finalize Deletion"
                        >
                            <ShieldAlert className="size-4 mr-1.5" />
                            <span className="text-[10px] font-bold uppercase">Approve</span>
                        </Button>
                    </div>
                ),
            },
        ],
        [cancelMutate.isPending, approveMutate.isPending]
    );

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6 font-sans antialiased">
            <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SharpInteractiveKPICard
                    title="Removal Requests"
                    value={stats.totalPending.toString()}
                    subtext="Employees pending administrative removal"
                    icon={UserX}
                    theme="rose"
                    active={true}
                />
                <SharpInteractiveKPICard
                    title="Active Employees"
                    value="Synced"
                    subtext="View main list to see totals"
                    icon={Users}
                    theme="blue"
                    active={false}
                />
            </motion.div>

            <motion.div variants={itemVariants} className="border border-border bg-card rounded-none shadow-none overflow-hidden">
                <div className="border-b border-border/50 px-5 py-4 bg-muted/20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Trash2 className="size-4 text-rose-500" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground">Pending Deletion Registry</span>
                    </div>
                    <Badge variant="secondary" className="bg-rose-500 text-white rounded-none font-black text-[10px]">CRITICAL</Badge>
                </div>

                {records.length === 0 ? (
                    <div className="py-16 bg-muted/10">
                        <GenericEmpty
                            icon={HREmptyIllustration}
                            title="All clear"
                            description="There are no pending employee removal requests."
                        />
                    </div>
                ) : (
                    <DataTable
                        columns={columns}
                        data={records}
                        searchKey="employee"
                        searchPlaceholder="Search registry..."
                        pageSize={10}
                        className="border-none shadow-none rounded-none"
                    />
                )}
            </motion.div>

            {/* Final Confirmation Dialog */}
            <ResponsiveDialog
                open={!!approvalId}
                onOpenChange={(open) => !open && setApprovalId(null)}
                title="Irreversible Data Removal"
                description="You are about to permanently delete this employee and all associated system records."
                icon={ShieldAlert}
                className="max-w-md"
            >
                <div className="space-y-6 pt-2">
                    <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border-2 border-rose-200 dark:border-rose-900 flex flex-col gap-3">
                        <div className="flex items-center justify-between border-b border-rose-200 dark:border-rose-900 pb-2">
                            <span className="text-[10px] font-black uppercase  text-rose-600">Target Record</span>
                            <span className="font-mono text-[10px] font-bold text-rose-500">{selectedEmployee?.employeeCode}</span>
                        </div>
                        <p className="text-lg font-black text-rose-800 dark:text-rose-100 uppercase tracking-tight leading-tight">
                            {selectedEmployee?.firstName} {selectedEmployee?.lastName}
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 p-4 bg-muted border rounded-none text-xs text-muted-foreground">
                        <p className="font-bold flex items-center gap-2 text-foreground uppercase  text-[10px]">
                            <AlertTriangle className="size-3.5 text-amber-500" /> System Warning
                        </p>
                        <p>Approving this will permanently purge:</p>
                        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 list-disc pl-4 opacity-80">
                            <li>Attendance History</li>
                            <li>Payslip Calculations</li>
                            <li>Salary Advance Logs</li>
                            <li>Travel Expense Sheets</li>
                            <li>Bradford Audit Logs</li>
                            <li>Personal Profile</li>
                        </ul>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
                        <Button
                            variant="outline"
                            onClick={() => setApprovalId(null)}
                            disabled={approveMutate.isPending}
                        >
                            Abort
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => approvalId && approveMutate.mutate({ data: { id: approvalId } }, { onSuccess: () => setApprovalId(null) })}
                            disabled={approveMutate.isPending}
                        >
                            {approveMutate.isPending ? "Executing Purge..." : "Confirm Permanent Removal"}
                        </Button>
                    </div>
                </div>
            </ResponsiveDialog>
        </motion.div>
    );
}

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
    blue: { border: "border-blue-500", iconBg: "bg-blue-500/10", iconText: "text-blue-500", activeBg: "bg-blue-500/5 transition-colors" },
    rose: { border: "border-rose-500", iconBg: "bg-rose-500/10", iconText: "text-rose-500", activeBg: "bg-rose-500/5 transition-colors" },
    emerald: { border: "border-emerald-500", iconBg: "bg-emerald-500/10", iconText: "text-emerald-500", activeBg: "bg-emerald-500/5" },
    violet: { border: "border-violet-500", iconBg: "bg-violet-500/10", iconText: "text-violet-500", activeBg: "bg-violet-500/5" },
    amber: { border: "border-amber-500", iconBg: "bg-amber-500/10", iconText: "text-amber-500", activeBg: "bg-amber-500/5" },
};

function SharpInteractiveKPICard({
    title,
    value,
    subtext,
    icon: Icon,
    theme,
    active,
    onClick
}: {
    title: string;
    value: string;
    subtext: string;
    icon: any;
    theme: KPITheme;
    active: boolean;
    onClick?: () => void;
}) {
    const styles = sharpThemeStyles[theme];

    return (
        <motion.div
            whileHover={onClick ? { y: -2, transition: { duration: 0.2 } } : {}}
            onClick={onClick}
            className={cn(
                "relative flex flex-col justify-between p-5 bg-card border rounded-none shadow-none transition-colors border-t-2",
                active ? cn("border-x border-b", styles.border, styles.activeBg) : cn("border-border", onClick && "hover:bg-muted/30 cursor-pointer")
            )}
        >
            <div
                className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
                style={{ backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`, backgroundSize: "8px 8px" }}
            />
            <div className="relative z-10 flex items-start justify-between mb-8">
                <p className="text-[10px] font-bold  text-muted-foreground uppercase">{title}</p>
                <div className="flex items-center gap-2">
                    {active && <Badge variant="outline" className={cn("text-[9px] uppercase font-black rounded-none border-border", styles.iconText)}>Full Registry</Badge>}
                    <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
                        <Icon className={cn("size-4", styles.iconText)} />
                    </div>
                </div>
            </div>
            <div className="relative z-10 space-y-1">
                <h3 className="text-3xl font-black tracking-tight text-foreground tabular-nums">{value}</h3>
                <p className="text-[10px] font-bold uppercase  text-muted-foreground/70">{subtext}</p>
            </div>
        </motion.div>
    );
}
